import {useEffect,useRef,useState,type ReactNode} from 'react';

// A single-finger pull from the top refreshes only the two overview pages.
// Native map, slider, input and horizontal gestures keep their own handlers.
export default function RefreshSurface({active,onRefresh,children}:{active:boolean;onRefresh:()=>Promise<unknown>;children:ReactNode}){
  const gesture=useRef<{x:number;y:number}|null>(null),distance=useRef(0),flight=useRef(false);
  const surface=useRef<HTMLDivElement>(null);
  const [pull,setPull]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){if(flight.current)return;flight.current=true;setBusy(true);setError('');try{await onRefresh();}catch{setError('刷新未完成，请用刷新按钮重试。');}finally{flight.current=false;setBusy(false);}}
  function cancel(){gesture.current=null;distance.current=0;setPull(0);}
  useEffect(()=>{
    cancel();const node=surface.current;if(!active||!node)return;
    const move=(e:TouchEvent)=>{const start=gesture.current;if(!start||e.touches.length!==1)return;const dx=e.touches[0].clientX-start.x,dy=e.touches[0].clientY-start.y;if(dy>12&&dy>Math.abs(dx)&&e.cancelable)e.preventDefault();};
    node.addEventListener('touchmove',move,{passive:false});return()=>node.removeEventListener('touchmove',move);
  },[active]);
  return <div ref={surface} onTouchStart={e=>{cancel();if(!active||flight.current||window.scrollY>0||e.touches.length!==1||(e.target as Element).closest('button,a,input,textarea,select,.map-view,.garage-stage,dialog'))return;gesture.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}}
    onTouchMove={e=>{if(!gesture.current||e.touches.length!==1){cancel();return;}const dx=e.touches[0].clientX-gesture.current.x,dy=e.touches[0].clientY-gesture.current.y;if(Math.abs(dx)>Math.max(20,Math.abs(dy))||dy<0){cancel();return;}distance.current=Math.min(100,dy);setPull(distance.current);}}
    onTouchCancel={cancel} onTouchEnd={()=>{const shouldRefresh=distance.current>=72;cancel();if(shouldRefresh)void refresh();}}>
    {(pull>20||busy||error)&&<div className="pull-status" role="status">{error|| (busy?'正在刷新…':pull>=72?'松开刷新':'继续下拉刷新')}</div>}{children}
  </div>;
}
