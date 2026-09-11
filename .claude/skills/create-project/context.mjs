export function buildContext(name, config, comments, groupKeys, stories) {
	const parts = [`# ${name}`, ''];
	if (comments.overview) parts.push(comments.overview, '');

	if (stories?.length) {
		parts.push('## Engineered Behaviors', '');
		parts.push(`${stories.length} machine-verified story patterns (from the dungeon's \`stories\` export):`, '');
		for (const s of stories) {
			const arch = s.archetype ? ` — ${s.archetype}` : '';
			parts.push(`### ${s.id}${arch}`, '');
			if (s.narrative) parts.push(String(s.narrative).trim(), '');
			if (s.mixpanelReport && typeof s.mixpanelReport === 'object') {
				parts.push('How to see it in Mixpanel:');
				for (const [k, v] of Object.entries(s.mixpanelReport)) {
					parts.push(`- **${k}**: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
				}
				parts.push('');
			}
			if (Array.isArray(s.intentionalDeviations) && s.intentionalDeviations.length) {
				parts.push('Notes:', ...s.intentionalDeviations.map((d) => `- ${d}`), '');
			}
		}
	} else if (comments.hookStories) {
		parts.push('## Engineered Behaviors', '', comments.hookStories, '');
	}

	parts.push('## Schema', '');
	const events = config.events || [];
	parts.push(`### Events (${events.length})`);
	for (const e of events) {
		const props = e.properties ? Object.keys(e.properties).join(', ') : '';
		const weight = e.weight != null ? ` (weight ${e.weight})` : '';
		parts.push(`- ${e.event}${weight}${props ? ` — ${props}` : ''}`);
	}
	parts.push('');

	const funnels = config.funnels || [];
	if (funnels.length) {
		parts.push(`### Funnels (${funnels.length})`);
		for (const f of funnels) {
			const seq = (f.sequence || []).join(' → ');
			const rate = f.conversionRate != null ? ` (${f.conversionRate}%)` : '';
			parts.push(`- ${f.name || '(unnamed)'}: ${seq}${rate}`);
		}
		parts.push('');
	}

	if (groupKeys.length) {
		parts.push('### Group keys', ...groupKeys.map((g) => `- ${g.property_name} (${g.display_name})`), '');
	}

	const standaloneEvents = config.standaloneEvents || [];
	if (standaloneEvents.length) {
		parts.push(`### Standalone events (${standaloneEvents.length})`);
		parts.push('Cadence streams use the normal event send path. Their synthetic distinct_id values are never people counts or identity-model evidence.', '');
		for (const stream of standaloneEvents) {
			const dimensions = Object.entries(stream.dimensions || {}).map(([key, values]) => `${key} (${values.length} values)`);
			const properties = Object.keys(stream.properties || {});
			const identity = stream.distinctIdFrom ? `dimension ${stream.distinctIdFrom}` : 'event name';
			parts.push(`- ${stream.event}: cadence ${stream.cadence ?? 'day'}; dimensions ${contextList(dimensions)}; properties ${contextList(properties)}; synthetic distinct_id from ${identity}`);
		}
		parts.push('');
	}

	const warehouseMetrics = config.warehouseMetrics || [];
	if (warehouseMetrics.length) {
		parts.push(`### Warehouse metrics (${warehouseMetrics.length})`);
		parts.push('Sum adds buckets; LastValue reads the latest snapshot.', '');
		parts.push('Separate /warehouse-metrics deployment is required; provisioning and sendToMixpanel do not load warehouse tables or save warehouse metrics.', '');
		for (const metric of warehouseMetrics) {
			const type = metric.type ?? 'additive';
			const source = metric.source;
			const aggregation = type === 'point-in-time' ? 'LastValue' : 'Sum';
			parts.push(`- ${metric.name}: type ${type}; grain ${metric.grain ?? 'day'}; history ${metric.history ?? 0} periods before the event window; sparse ${metric.sparse ?? false}; Mixpanel aggregation ${aggregation}`);
			if (type === 'point-in-time') parts.push(`  baseline ${metric.baseline ?? 0} (point-in-time starting level)`);
			parts.push(`  source events ${contextList(source.event)}; minus ${contextList(source.minus)}; measure ${source.measure ?? 'count'}; property ${source.property ?? '(none)'}; where ${source.where ? 'present (function, not evaluated)' : '(none)'}`);
			parts.push(`  columns: time ${metric.timeColumn ?? 'date'}; value ${metric.valueColumn ?? 'value'}; groupBy ${contextList(source.groupBy)}; extra ${contextList(Object.keys(metric.columns || {}))}`);
		}
		parts.push('');
	}

	let md = parts.join('\n');
	if (md.length > 50000) md = md.slice(0, 49900) + '\n\n…(truncated to 50,000 chars)';
	return md;
}

function contextList(value) {
	return (Array.isArray(value) ? value.join(', ') : value) || '(none)';
}