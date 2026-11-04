export function verificationReportsView(reports,{escape:e,date}){
  if(!reports?.length)return '<section class="verification-reports"><h3>回查报告</h3><p class="muted">尚无报告。点击回查后会保存检查项、结论和建议。</p></section>';
  const labels={confirmed:'已确认',failed:'未完成',unknown:'未知'};
  return `<section class="verification-reports"><h3>回查报告</h3>${reports.map((r,index)=>`<details${index===0?' open':''}><summary>${index===0?'最近一次':'历史回查'} · ${date(r.checkedAt)} · ${r.outcome==='confirmed'?'核验完成':'仍待核实'}</summary><p>${e(r.summary)}</p><dl class="report-checks">${r.checks.map(c=>`<div><dt>${e(c.label)} <span class="badge ${c.status==='confirmed'?'green':'amber'}">${labels[c.status]||'未知'}</span></dt><dd>${e(c.detail)}</dd></div>`).join('')}</dl><h4>下一步</h4><ul>${(r.nextSteps||[]).map(s=>`<li>${e(s)}</li>`).join('')}</ul></details>`).join('')}</section>`;
}
