#!/usr/bin/env node
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { engine,doctor } from '../src/engine.mjs';
import { prepareJob,runJob,verifyJob,readJob } from '../src/jobs.mjs';

const help=`内容运营助手（抖音 / 视频号草稿）
  doctor                     检查环境
  accounts [--phone 分组]      查看账号
  prepare --input 任务.json     校验素材、自动准备封面
  prepare --phone 分组 --video 路径 --title 标题 [--description 简介]
          [--platform dy|sph] [--short-title 视频号短标题]
          [--cover 图片] [--mode draft|publish] [--visibility private|friends|public]
  run <任务编号>              只执行一次
  verify <任务编号>           只读回查，不重发
  show <任务编号>             查看本地记录
  works --phone 分组 [--work-id 作品编号]  只读查询平台作品
默认：草稿、仅自己可见；任务数据保存在 .local/。`;
try{
  const [command,...args]=process.argv.slice(2);
  if(!command||command==='--help'||args.includes('--help')){console.log(help);}
  else{
    const options={};
    for(const key of ['input','platform','phone','video','title','description','short-title','cover','mode','visibility','creative-statement','work-id']) options[key]={type:'string'};
    const {values,positionals}=parseArgs({args,options,allowPositionals:true});
    let result;
    if(command==='doctor')result=await doctor();
    else if(command==='accounts')result=await engine.accounts(values.phone,values.platform);
    else if(command==='prepare'){
      const input=values.input?JSON.parse(await fs.readFile(values.input,'utf8')):{...values,creativeStatement:values['creative-statement'],shortTitle:values['short-title']};
      result=await prepareJob(input);
    }
    else if(['run','verify','show'].includes(command)){
      if(positionals.length!==1)throw Error('需要一个任务编号');
      result=await ({run:runJob,verify:verifyJob,show:readJob}[command])(positionals[0],{engine});
    }
    else if(command==='works'){
      if(!values.phone)throw Error('需要 --phone 账号分组');
      result=await engine.query(values.phone,values['work-id']);
    }
    else throw Error('未知命令；使用 --help 查看用法');
    console.log(JSON.stringify(result,null,2));
    if(result?.state==='unknown'||result?.state==='running'||result?.ok===false||result?.complete===false)process.exitCode=4;
  }
}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}
