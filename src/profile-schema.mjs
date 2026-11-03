export const manualFields=[
 {key:'business',label:'客户是做什么的？',required:true,maxLength:2000},
 {key:'offering',label:'能提供什么？',required:true,maxLength:2000},
 {key:'goal',label:'做账号想达到什么目的？',required:true,maxLength:2000},
 {key:'audience',label:'希望吸引谁？',required:false,maxLength:2000},
 {key:'resources',label:'有哪些优势与限制？',required:false,maxLength:2000},
];
const platforms=['dy','sph','xhs'];
function str(value,label,required=true){if(typeof value!=='string'||value.length>2000||(required&&!value.trim()))throw Error(`${label}格式无效`);return value.trim();}
function list(value,label,{min=0,max=10}={}){if(!Array.isArray(value)||value.length<min||value.length>max)throw Error(`${label}数量无效`);return value.map(v=>str(v,label));}
export function validateProfileResult(result,{sourceIds=[]}={}){
 if(!result||typeof result!=='object'||Array.isArray(result))throw Error('画像结果格式无效');
 const out={};for(const key of ['positioning','niche','audience','value','style'])out[key]=str(result[key],key);
 out.columns=list(result.columns,'栏目',{min:3,max:5});
 if(!result.platformFocus||typeof result.platformFocus!=='object'||Array.isArray(result.platformFocus)||Object.keys(result.platformFocus).some(k=>!platforms.includes(k)))throw Error('平台侧重点无效');
 out.platformFocus={};for(const [k,v] of Object.entries(result.platformFocus))out.platformFocus[k]=str(v,'平台侧重点');
 out.boundaries=list(result.boundaries,'内容边界');out.questions=list(result.questions,'待确认问题',{max:3});
 if(!Array.isArray(result.observations)||result.observations.length>10)throw Error('观察依据无效');
 out.observations=result.observations.map(o=>{if(!o||typeof o!=='object'||!Array.isArray(o.sourceIds)||o.sourceIds.length>20||o.sourceIds.some(id=>!sourceIds.includes(id)))throw Error('观察来源无效');return {text:str(o.text,'观察'),sourceIds:[...new Set(o.sourceIds)]};});return out;
}
