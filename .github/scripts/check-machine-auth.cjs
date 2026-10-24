const assert = require('node:assert/strict');
const {appendFileSync} = require('node:fs');
const endpoint = 'https://terrakube-api.localhost';
const org = process.env.SMOKE_ORGANIZATION_ID;
const route = `/api/v1/organization/${org}`;
const results = [];

async function token(audience) {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', audience);
  const response = await fetch(url, {
    headers: {Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},
    signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, 'GitHub must issue an OIDC token');
  const {value} = await response.json();
  assert.equal(typeof value, 'string');
  console.log(`::add-mask::${value}`);
  return value;
}

async function api(jwt, method, path, data) {
  const response = await fetch(endpoint + path, {
    method,
    headers: {Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json'},
    ...(data ? {body: JSON.stringify({data})} : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  return {status: response.status, body: text ? JSON.parse(text) : null};
}

function job(workspace, template, extra = {}) {
  return {type: 'job', attributes: {
    templateReference: template, overrideBranch: process.env.GITHUB_REF_NAME,
    commitId: process.env.GITHUB_SHA, via: 'Github', ...extra
  }, relationships: {workspace: {data: {type: 'workspace', id: workspace}}}};
}

function denied(label, response) {
  assert.ok([401, 403].includes(response.status), `${label}: expected denial, got HTTP ${response.status}`);
  assert.ok(!response.body?.data?.id, `${label}: must not create a job`);
  results.push(`${label}: denied (${response.status})`);
  console.log(results.at(-1));
}

async function main() {
  if (process.argv[2] === 'expiry') {
    const jwt = await token('api://terrakube-local-variables');
    const {exp} = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
    appendFileSync(process.env.GITHUB_OUTPUT, `expires-at=${exp}\n`);
    console.log(`Initial OIDC lifetime: ${Math.round(exp - Date.now() / 1000)} seconds`);
    return;
  }
  const jwt = await token('api://terrakube-smoke-plan');
  const plan = process.env.SMOKE_PLAN_TEMPLATE_ID;
  const workspace = process.env.SMOKE_WORKSPACE_ID;
  denied('Plan identity cannot override variables', await api(jwt, 'POST', `${route}/job`, job(workspace, plan, {variables: {smoke_message: 'denied-override'}})));
  denied('Plan identity cannot queue jobs in another workspace', await api(jwt, 'POST', `${route}/job`, job(process.env.SMOKE_DENIED_WORKSPACE_ID, plan)));
  for (const boundary of ['audience', 'repository', 'branch', 'environment']) {
    const bad = await token(`api://terrakube-denied-${boundary}`);
    denied(`Wrong ${boundary}`, await api(bad, 'POST', `${route}/job`, job(workspace, plan)));
  }
  // The control template ends at approval: even an authorization regression cannot apply infrastructure.
  const created = await api(jwt, 'POST', `${route}/job`, job(process.env.SMOKE_CONTROL_WORKSPACE_ID, process.env.SMOKE_CONTROL_TEMPLATE_ID));
  assert.equal(created.status, 201, 'Plan identity must be able to queue an allowed job');
  const id = created.body.data.id;
  appendFileSync(process.env.GITHUB_OUTPUT, `control-job-id=${id}\n`);
  console.log(`Approval control job: ${id}`);
  let waiting = false;
  for (let attempt = 0; attempt < 36; attempt++) {
    const current = await api(jwt, 'GET', `${route}/job/${id}`);
    assert.equal(current.status, 200);
    const status = current.body.data.attributes.status;
    if (status === 'waitingApproval') {
      assert.equal(current.body.data.attributes.approvalTeam, 'action-smoke-apply');
      waiting = true;
      break;
    }
    assert.ok(!['failed', 'rejected', 'cancelled'].includes(status), `Control job ${id} ended as ${status}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.ok(waiting, 'Control plan must reach its approval gate');
  denied('Plan identity cannot approve a held job', await api(jwt, 'PATCH', `${route}/job/${id}`, {type: 'job', id, attributes: {status: 'approved'}}));
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Machine authentication\n\n${results.map(x => `- ${x}`).join('\n')}\n\nControl job ${id} has no apply step and can be discarded.\n`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
