import path from 'node:path';
export function desktopManifest(projectRoot,node){
  if(!path.isAbsolute(projectRoot)||!path.isAbsolute(node))throw Error('桌面应用需要明确的绝对路径');
  return {package:{name:'content-ops-desktop',productName:'内容运营助手',version:'0.4.0',main:'desktop/main.cjs',private:true,license:'GPL-2.0-only'},
    config:{projectRoot,node},info:{CFBundleDisplayName:'内容运营助手',CFBundleName:'内容运营助手',CFBundleIdentifier:'cn.local.contentops.assistant',CFBundleShortVersionString:'0.4.0',CFBundleVersion:'0.4.0',CFBundleIconFile:'content-ops.icns',NSHumanReadableCopyright:'GPL-2.0-only · 内容运营助手'}};
}
