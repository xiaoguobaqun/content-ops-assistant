import {AsyncLocalStorage} from 'node:async_hooks';

const context=new AsyncLocalStorage();
export function withCancellation(signal,work){return context.run(signal,work);}
export function currentSignal(){return context.getStore();}
export function throwIfCancelled(){currentSignal()?.throwIfAborted();}
