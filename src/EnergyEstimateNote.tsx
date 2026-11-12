export default function EnergyEstimateNote({calibration}:{calibration:any}){
  return <details className="energy-method"><summary>能耗估算说明</summary><p>源记录没有提供有效净能量时，用本车充电记录的“充入电量 ÷ 额定续航增量”标定，再根据行程额定续航变化估算电量。平均能耗使用有效行程的总电量 ÷ 总里程，不直接平均每段能耗。</p><p>充入电量与电网用电不是同一口径，充电损耗不会直接当作行程电量。SOC 与容量标定、温度、续航跳变和历史覆盖仍会影响结果；估算不等于车辆直接测得的电量。</p><p>标定使用 {calibration?.count??0}/{calibration?.total??0} 条已载入充电记录{calibration?.complete?'，充电历史已全部载入':'，仍可能缺少历史记录'}。缺少有效标定或行程精度不足时保持未知。</p></details>;
}
