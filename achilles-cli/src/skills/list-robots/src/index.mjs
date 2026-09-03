import { createRoboTeamClient } from '../../../lib/roboTeamClient.mjs';

function clean(value, fallback = '—') {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
}

export async function action(invocation = {}) {
    try {
        const client = await createRoboTeamClient(invocation);
        const result = await client.call('robot_list', {});
        const robots = Array.isArray(result.robots) ? result.robots : [];
        if (robots.length === 0) return 'No RoboTeam robots are available in this workspace.';
        return robots.map((robot) => {
            const mode = clean(robot.run?.mode, 'stopped');
            const state = clean(robot.run?.state, 'stopped');
            return `- ${clean(robot.name, 'Unnamed robot')} — ${clean(robot.specialization)} — ${mode}/${state}`;
        }).join('\n');
    } catch (error) {
        return `Could not list RoboTeam robots: ${error?.message || 'request failed'}`;
    }
}

export default action;
