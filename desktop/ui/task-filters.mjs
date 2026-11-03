export function operationTime(record){
  return Math.max(0,...['createdAt','startedAt','finishedAt','checkedAt'].map(k=>Number.isFinite(record[k])?record[k]:0),...(record.jobs||[]).map(operationTime));
}
function calendarDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('日期格式无效');const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d);
  if(date.getFullYear()!==y||date.getMonth()!==m-1||date.getDate()!==d)throw Error('日期无效');return date;
}
export function filterTaskDates(rows,from='',to=''){
  const start=from?calendarDate(from).getTime():-Infinity;let end=Infinity;
  if(to){const next=calendarDate(to);next.setDate(next.getDate()+1);end=next.getTime();}
  if(start>=end)throw Error('开始日期不能晚于结束日期');return rows.filter(row=>{const time=operationTime(row);return time>=start&&time<end;});
}
