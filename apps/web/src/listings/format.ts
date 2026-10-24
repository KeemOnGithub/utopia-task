export function formatTimestamp(timestamp:string):string {
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(timestamp));
 const get=(type:string)=>parts.find(p=>p.type===type)?.value;
 return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} MYT`;
}
