const path=require('node:path');
function desktopRuntime({config={},appRoot,userDataPath,documentsPath,platform=process.platform,env=process.env}){
  const p=platform==='win32'?path.win32:path.posix;
  const projectRoot=config.portable?appRoot:config.projectRoot||appRoot;
  const dataRoot=env.CONTENT_OPS_DATA_ROOT||(config.portable?p.join(userDataPath,'workspace'):p.join(projectRoot,'.local'));
  if(!p.isAbsolute(projectRoot)||!p.isAbsolute(dataRoot))throw Error('程序和数据目录必须使用绝对路径');
  return {projectRoot,dataRoot,node:config.portable?p.join(projectRoot,'runtime',platform==='win32'?'node.exe':'node'):config.node||env.CONTENT_OPS_NODE||(platform==='darwin'?p.join(projectRoot,'.validation/toolchain/node-v20.20.2-darwin-arm64/bin/node'):'node'),
    documentsPath:config.portable||env.CONTENT_OPS_DATA_ROOT?p.join(dataRoot,'documents'):documentsPath,
    engineUserData:config.portable||env.CONTENT_OPS_DATA_ROOT?p.join(dataRoot,'engine-profile'):undefined,
    runtimeBin:config.portable?p.join(projectRoot,'runtime'):undefined};
}
module.exports={desktopRuntime};
