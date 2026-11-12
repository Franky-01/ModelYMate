import {Zap} from 'lucide-react';
export default function ChargeIndicator({active=false,phase='unknown'}:{active?:boolean;phase?:string}){
 return <div className={'charge-animation '+(active?'is-charging':'')} data-charge-phase={phase} aria-hidden="true"><span className="charge-halo"/><Zap size={28}/><span className="charge-flow"><i/><i/><i/></span></div>;
}
