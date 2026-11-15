/* Pure DIP geometry. Supports rows, columns, and grids without overlap. */
(() => {
  const overlap = (a,b) => a.x < b.x+b.w-.001 && a.x+a.w > b.x+.001 && a.y < b.y+b.h-.001 && a.y+a.h > b.y+.001;
  function snapScreen(moving,screens) {
    const others=screens.filter(s=>s.deviceId!==moving.deviceId);
    if(!others.length)return {...moving};
    const candidates=[];
    for(const s of others){
      for(const y of [s.y,s.y+s.h-moving.h])candidates.push({...moving,x:s.x-moving.w,y},{...moving,x:s.x+s.w,y});
      for(const x of [s.x,s.x+s.w-moving.w])candidates.push({...moving,x,y:s.y-moving.h},{...moving,x,y:s.y+s.h});
    }
    return candidates.filter(c=>!others.some(s=>overlap(c,s)))
      .sort((a,b)=>Math.hypot(a.x-moving.x,a.y-moving.y)-Math.hypot(b.x-moving.x,b.y-moving.y))[0] || null;
  }
  function swapTarget(moving,screens) {
    const cx=moving.x+moving.w/2,cy=moving.y+moving.h/2;
    return screens.find(s=>s.deviceId!==moving.deviceId && cx>=s.x && cx<s.x+s.w && cy>=s.y && cy<s.y+s.h);
  }
  function arrangeScreens(moving,screens) {
    const original=screens.find(s=>s.deviceId===moving.deviceId);
    const target=swapTarget(moving,screens);
    if(original && target){
      const next=screens.map(s=>s.deviceId===original.deviceId ? {...s,x:target.x,y:target.y}
        : s.deviceId===target.deviceId ? {...s,x:original.x,y:original.y} : s);
      return next.every((a,i)=>next.every((b,j)=>i===j || !overlap(a,b))) ? next : null;
    }
    if(original && moving.x+moving.w/2>=original.x && moving.x+moving.w/2<original.x+original.w
      && moving.y+moving.h/2>=original.y && moving.y+moving.h/2<original.y+original.h)return screens;
    const snapped=snapScreen(moving,screens);
    return snapped ? screens.map(s=>s.deviceId===moving.deviceId ? snapped : s) : null;
  }
  function fitScreens(screens,width,height) {
    if (!screens.length) return {scale:1,x:0,y:0};
    const minX=Math.min(...screens.map(s=>s.x)),minY=Math.min(...screens.map(s=>s.y));
    const w=Math.max(...screens.map(s=>s.x+s.w))-minX,h=Math.max(...screens.map(s=>s.y+s.h))-minY;
    const scale=Math.max(.001,Math.min((width-64)/w,(height-64)/h,.22));
    return {scale,x:(width-w*scale)/2-minX*scale,y:(height-h*scale)/2-minY*scale};
  }
  window.ControlLayout={overlap,snapScreen,fitScreens,arrangeScreens,swapTarget};
})();
