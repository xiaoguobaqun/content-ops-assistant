/** 只有实际可解码、且指向微信的二维码才能作为扫码图。 */
export function pickSphQrCapture(captured,decode){
  if(!captured?.buf)return null;
  try{const value=decode(captured.buf),url=new URL(value);return ['https:','http:'].includes(url.protocol)&&(url.hostname==='weixin.qq.com'||url.hostname.endsWith('.weixin.qq.com'))&&!url.username&&!url.password?captured:null;}catch{return null;}
}
