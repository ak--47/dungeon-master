import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import mixpanel_headless as mp


def main():
    specification = json.loads(Path(sys.argv[1]).read_text())
    run_id = specification["runId"]
    if not run_id.startswith("dm182-") or not all(character.isalnum() or character in "-_" for character in run_id):
        raise ValueError("Invalid alignment run ID")
    if not specification["name"] or not all(character.isalnum() or character in "-_" for character in specification["name"]):
        raise ValueError("Invalid query name")
    project_id = 4063241
    root = Path(__file__).resolve().parents[3]
    artifacts = root / "tmp" / "alignment-1.8.2"
    ledger_path = artifacts / "queries.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else []
    now = datetime.now(timezone.utc)
    recent = [entry for entry in ledger if now.timestamp() - entry["timestamp"] < 3600]
    if len(recent) >= 180:
        raise RuntimeError("Local hourly query budget reached; do offline work before retrying")
    workspace = mp.Workspace(session=mp.Session(
        account=mp.OAuthTokenAccount(name="dm-live", region="us", token_env="MP_OAUTH_TOKEN"),
        project=mp.Project(id=str(project_id)),
    ))
    filters = [mp.Filter.equals("alignment_run_id", run_id, resource_type="events")]
    for key, value in specification.get("filters", {}).items():
        filters.append(mp.Filter.equals(key, value, resource_type="events"))
    options = {"from_date": specification["from"], "to_date": specification["to"], "where": filters}
    options.update(specification.get("options", {}))
    if "where" in specification.get("options", {}):
        raise ValueError("Run isolation filters cannot be overridden by options")
    query_limit = options.pop("limit", 50000)
    kind = specification["kind"]
    if kind == "insights":
        metrics = [mp.Metric(**metric) for metric in specification["metrics"]]
        params = workspace.build_params(metrics, **options)
    elif kind == "funnel":
        steps = [mp.FunnelStep(name, filters=filters) for name in specification["steps"]]
        params = workspace.build_funnel_params(steps, **options)
    elif kind == "retention":
        params = workspace.build_retention_params(
            mp.RetentionEvent(specification["birth"], filters=filters),
            mp.RetentionEvent(specification["return"], filters=filters), **options)
    elif kind == "flow":
        options.pop("where")
        params = workspace.build_flow_params(mp.FlowStep(specification["anchor"], filters=filters), **options)
    elif kind == "events":
        params = {"from_date": specification["from"], "to_date": specification["to"],
                  "events": specification.get("events"), "limit": 1000,
                  "where": f'properties["alignment_run_id"] == {json.dumps(run_id)}'}
    elif kind == "frequency":
        params = {"from_date": specification["from"], "to_date": specification["to"],
                  "event": specification["event"], "unit": specification.get("unit", "week"),
                  "addiction_unit": specification.get("addictionUnit", "day"),
                  "where": f'properties["alignment_run_id"] == {json.dumps(run_id)}'}
    else:
        raise ValueError(f"Unsupported query kind: {kind}")
    if "measurement" in specification:
        for metric in params["sections"]["show"]:
            metric["measurement"].update(specification["measurement"])
    if "group" in specification:
        params["sections"]["group"] = specification["group"]
        for group in params["sections"]["group"]:
            if "behavior" in group:
                group["behavior"]["filters"] = params["sections"]["filter"]
    if "frequencyBreakdown" in specification:
        from mixpanel_headless._internal.bookmark_builders import build_frequency_group_entry
        group = build_frequency_group_entry(mp.FrequencyBreakdown(**specification["frequencyBreakdown"]))
        group["behavior"]["filters"] = params["sections"]["filter"]
        params["sections"]["group"].append(group)
    for key, value in specification.get("displayOptions", {}).items():
        params["displayOptions"][key] = value
    body = {"bookmark": params, "project_id": project_id, "queryLimits": {"limit": query_limit}}
    output = artifacts / run_id / f'{specification["name"]}.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        previous = output.with_name(f'{output.stem}-{now.strftime("%Y%m%dT%H%M%S%f")}.json')
        previous.write_bytes(output.read_bytes())
    entry = {"timestamp": now.timestamp(), "at": now.isoformat(), "runId": run_id,
             "name": specification["name"], "kind": kind, "state": "started"}
    ledger.append(entry)
    ledger_path.write_text(json.dumps(ledger, indent=2) + "\n")
    evidence = {"specification": specification, "request": body, "at": now.isoformat()}
    try:
        if kind == "events":
            response = {"events": list(workspace.stream_events(**params, raw=True))}
        elif kind == "frequency":
            response = workspace.api.frequency(**params)
        elif kind == "flow":
            body["query_type"] = "flows_sankey"
            response = workspace.api.arb_funnels_query(body, inject_workspace_id=False)
        else:
            response = workspace.api.insights_query(body, inject_workspace_id=False)
        evidence["response"] = response
        if response.get("error") or response.get("status") == "error":
            raise RuntimeError("Mixpanel returned a query error in the response body")
        metadata = response.get("meta", {})
        if metadata.get("is_segmentation_limit_hit") or metadata.get("min_sampling_factor", 1) != 1:
            raise RuntimeError("Exact comparisons require unsampled, untruncated query results")
        entry["state"] = "complete"
        output.write_text(json.dumps(evidence, indent=2) + "\n")
        print(json.dumps({"output": str(output), "keys": list(response), "queryCountThisHour": len(recent) + 1}))
    except Exception as error:
        entry["state"] = "failed"
        evidence["error"] = {"type": type(error).__name__, "message": str(error)}
        output.write_text(json.dumps(evidence, indent=2) + "\n")
        raise
    finally:
        ledger_path.write_text(json.dumps(ledger, indent=2) + "\n")


if __name__ == "__main__":
    main()