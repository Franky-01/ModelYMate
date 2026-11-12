type Props={message?:string;onRetry?:()=>void;retryLabel?:string;disabled?:boolean};

// One stable loading surface is shared by data readiness, the lazy module,
// and model/GPU preparation, including the personalization preview.
export default function GarageLoading({message='正在准备车库…',onRetry,retryLabel='重新载入',disabled=false}:Props){
 return <div className="garage-loading" role="status" aria-live="polite"><span>{message}</span>{onRetry&&<button type="button" disabled={disabled} onClick={onRetry}>{retryLabel}</button>}</div>;
}
