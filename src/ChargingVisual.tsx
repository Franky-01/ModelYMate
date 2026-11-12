import {Component,lazy,Suspense,type ReactNode} from 'react';
import {Zap} from 'lucide-react';
import './charging-scene.css';
import type {VehicleModelID} from './vehicle-types';

const ChargingScene=lazy(()=>import('./ChargingScene'));

class SceneBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<div className="charging-scene"><div className="charging-scene-message">充电视图暂不可用，充电数据仍可查看</div></div>:this.props.children;}
}

export default function ChargingVisual({soc,limit,active,phase,label='充电状态未知',modelId}:{soc:number|null;limit:number|null;active:boolean;phase:string;label?:string;modelId?:VehicleModelID}){
 return <div className="charging-visual" data-charge-phase={phase}>
  <div className="charging-overview">
   <span className="charging-state"><Zap size={17}/>{label}</span>
   <div className="charging-soc" aria-label={soc===null?'电量未知':`电量 ${Math.round(soc)}%`}>
    <strong>{soc===null?'—':Math.round(soc)}</strong><span>%</span>
   </div>
   <span className="charging-soc-caption">{phase==='history'||phase==='offline'?'最近报告电量':'电池电量'}</span>
  </div>
  <SceneBoundary key={modelId}><Suspense fallback={<div className="charging-scene"><div className="charging-scene-message">正在准备充电视图…</div></div>}>
   <ChargingScene soc={soc} limit={limit} active={active} modelId={modelId}/>
  </Suspense></SceneBoundary>
 </div>;
}
