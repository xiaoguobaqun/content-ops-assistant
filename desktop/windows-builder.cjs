const path=require('node:path');
const fs=require('node:fs/promises');

async function latestTimestamp(dir){
  let latest=0;
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const target=path.join(dir,entry.name);latest=Math.max(latest,entry.isDirectory()?await latestTimestamp(target):(await fs.stat(target)).mtimeMs);
  }
  return latest;
}

function windowsBuilderConfig({projectRoot,stageRoot,outputRoot,electronVersion}){
  return {
    appId:'cn.local.contentops.assistant',productName:'内容运营助手',executableName:'Content-Ops-Assistant',
    electronVersion,asar:false,npmRebuild:false,buildDependenciesFromSource:false,forceCodeSigning:false,
    directories:{app:stageRoot,output:outputRoot,buildResources:path.join(projectRoot,'desktop')},
    files:['package.json','desktop-config.json','LICENSE','desktop/**/*','src/**/*','bin/**/*','runtime/**/*','engine/MatrixMedia/package.json','engine/MatrixMedia/LICENSE','engine/MatrixMedia/dist/**/*','engine/MatrixMedia/src/**/*','engine/MatrixMedia/static/**/*','engine/MatrixMedia/lib/**/*','engine/MatrixMedia/.electron-vue/webpack.main.config.js'],
    // electron-builder prunes nested node_modules from its normal app copy.
    extraResources:[{from:path.join(stageRoot,'engine/MatrixMedia/node_modules'),to:'app/engine/MatrixMedia/node_modules',filter:['**/*']}],
    artifactName:'Content-Ops-Assistant-${version}-win-${arch}-setup.${ext}',
    electronLanguages:['zh-CN','en-US'],publish:null,
    win:{target:[{target:'nsis',arch:['x64']}],icon:path.join(projectRoot,'engine/MatrixMedia/lib/icons/icon.ico'),legalTrademarks:'GPL-2.0-only · 内容运营助手'},
    nsis:{oneClick:false,perMachine:false,allowElevation:false,packElevateHelper:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'内容运营助手',uninstallDisplayName:'内容运营助手',deleteAppDataOnUninstall:false,runAfterFinish:false,unicode:true,installerLanguages:['zh_CN'],language:'2052'},
    afterPack:async context=>{
      // Files copied by packagers may acquire new timestamps. Retain assertBuilt's freshness check.
      const engine=path.join(context.appOutDir,'resources/app/engine/MatrixMedia');
      const latest=Math.max(await latestTimestamp(path.join(engine,'src/main')),await latestTimestamp(path.join(engine,'src/shared')),(await fs.stat(path.join(engine,'.electron-vue/webpack.main.config.js'))).mtimeMs);
      const main=path.join(engine,'dist/electron/main.js'),stamp=new Date(Math.max(Date.now(),latest)+2000);
      await fs.utimes(main,stamp,stamp);
    }
  };
}
module.exports={windowsBuilderConfig};
