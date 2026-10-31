export function createFormRevision(){
  let revision=0,job=null;
  return {edit(){revision++;job=null;},begin(){return revision;},commit(snapshot,value){if(snapshot!==revision)return false;job=value;return true;},get job(){return job;},get revision(){return revision;}};
}
