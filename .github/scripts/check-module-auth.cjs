const assert = require('node:assert/strict');
const {appendFileSync} = require('node:fs');
const endpoint = 'https://terrakube-api.localhost';
const route = `/api/v1/organization/${process.env.TK_ORG}`;
const checks = [];

async function token(audience = 'api://module-validation') {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', audience);
  const response = await fetch(url, {headers: {Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});
  assert.equal(response.status, 200, 'GitHub must issue an OIDC token');
  const {value} = await response.json();
  assert.equal(typeof value, 'string');
  console.log(`::add-mask::${value}`);
  const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url'));
  console.log('Issued workload context:', JSON.stringify({repository:claims.repository,event:claims.event_name,ref:claims.ref,environment:claims.environment || null}));
  return value;
}

async function api(jwt, method, path, data) {
  const response = await fetch(endpoint + path, {
    method,
    headers: {Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json'},
    ...(data ? {body: JSON.stringify({data})} : {}),
    redirect: 'error', signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let body;
  try {body = text ? JSON.parse(text) : null;} catch {body = null;}
  return {status: response.status, body};
}

function job(workspace, template, extra = {}) {
  return {type: 'job', attributes: {
    templateReference: template, overrideBranch: process.env.GITHUB_REF_NAME,
    commitId: process.env.GITHUB_SHA, via: 'Github', ...extra
  }, relationships: {workspace: {data: {type: 'workspace', id: workspace}}}};
}

function denied(label, response) {
  const passed = [401,403,404].includes(response.status) && !response.body?.data?.id;
  checks.push({label, status: response.status, passed, unexpectedJobId: passed ? undefined : response.body?.data?.id});
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${label} (HTTP ${response.status})`);
}

async function main() {
  const jwt = await token();
  const purpose = process.argv[2] || 'plan';
  const read = await api(jwt, 'GET', `${route}/workspace/${process.env.TK_WORKSPACE}`);
  assert.equal(read.status, 200, 'Mapped identity must read its selected workspace');
  const other = await api(jwt, 'GET', `${route}/workspace/${process.env.TK_OTHER}`);
  console.log(`Unbound workspace read: HTTP ${other.status}`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Unbound workspace metadata read: HTTP ${other.status}\n\n`);
  denied(`${purpose} identity cannot queue in another workspace`, await api(jwt, 'POST', `${route}/job`, job(process.env.TK_OTHER, process.env.TK_PLAN_TEMPLATE)));
  denied(`${purpose} identity cannot modify workspace settings`, await api(jwt, 'PATCH', `${route}/workspace/${process.env.TK_WORKSPACE}`, {type:'workspace',id:process.env.TK_WORKSPACE,attributes:{description:'unauthorized test change'}}));
  if (purpose === 'plan') {
    denied('Plan identity cannot override variables', await api(jwt, 'POST', `${route}/job`, job(process.env.TK_WORKSPACE, process.env.TK_PLAN_TEMPLATE, {variables:{smoke_message:'must-be-denied'}})));
    for (const boundary of ['audience','repository','ref','environment','event']) {
      const bad = await token(`api://module-validation-denied-${boundary}`);
      denied(`Wrong ${boundary}`, await api(bad, 'POST', `${route}/job`, job(process.env.TK_WORKSPACE, process.env.TK_PLAN_TEMPLATE)));
    }
    const control = await api(jwt,'POST',`${route}/job`,job(process.env.TK_CONTROL,process.env.TK_CONTROL_TEMPLATE));
    assert.equal(control.status,201,'Plan identity must create the approval control job');
    const id=control.body.data.id;
    appendFileSync(process.env.GITHUB_OUTPUT,`control-job-id=${id}\n`);
    console.log(`Control job: ${id}`);
    let held=false;
    for(let i=0;i<60;i++) {
      const current=await api(jwt,'GET',`${route}/job/${id}`);
      assert.equal(current.status,200);
      const status=current.body.data.attributes.status;
      if(status==='waitingApproval'){held=true;break;}
      assert.ok(!['failed','rejected','cancelled'].includes(status),`Control job ended as ${status}`);
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
    assert.ok(held,'Control job must reach approval');
    denied('Plan identity cannot approve a held job',await api(jwt,'PATCH',`${route}/job/${id}`,{type:'job',id,attributes:{status:'approved'}}));
    denied('Plan identity cannot discard a held job',await api(jwt,'PATCH',`${route}/job/${id}`,{type:'job',id,attributes:{status:'rejected'}}));
  } else {
    denied('Apply identity cannot create a new plan',await api(jwt,'POST',`${route}/job`,job(process.env.TK_WORKSPACE,process.env.TK_PLAN_TEMPLATE)));
    const id=process.env.TK_CONTROL_JOB;
    assert.ok(id,'Original control job is required');
    const discarded=await api(jwt,'PATCH',`${route}/job/${id}`,{type:'job',id,attributes:{status:'rejected'}});
    checks.push({label:'Apply identity can discard a held control job',status:discarded.status,passed:[200,204].includes(discarded.status)});
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### ${purpose} identity boundaries\n\n| Check | HTTP | Result |\n| --- | --- | --- |\n${checks.map(c=>`| ${c.label} | ${c.status} | ${c.passed?'PASS':'FAIL'} |`).join('\n')}\n`);
  assert.ok(checks.every(c=>c.passed),'One or more live authorization boundaries failed');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
