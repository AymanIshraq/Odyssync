/* Development only. Never loaded by index.html. */
(() => {
  let listeners=[],notices=[];
  const self={deviceId:'a1111111',profile:{displayName:'DESKTOP-DEMO'}};
  let state={self,isHost:false,members:[],screens:[]};
  const emit=()=>listeners.forEach(fn=>fn(structuredClone(state)));
  const requireHost=()=>{if(!state.isHost)throw Error('Only the host can change room controls.');};
  function addMember(member){
    if(state.members.length>=4)throw Error('The room is full. Wait for a laptop to leave.');
    if(state.members.some(m=>m.deviceId===member.deviceId))throw Error('This laptop is already in the room.');
    state.members.push(member);
    state.screens.push({deviceId:member.deviceId,x:state.screens.reduce((sum,s)=>sum+s.w,0),y:0,w:1920,h:1080});
    state.modes[member.deviceId]='collaborative';
    state.management.sharingPermissions[member.deviceId]??=true;
  }
  function requestJoin(member){
    if(state.members.some(m=>m.deviceId===member.deviceId)||state.management.joinRequests.some(r=>r.member.deviceId===member.deviceId))throw Error('This laptop is already in the room or waiting to join.');
    if(state.management.manualApproval)state.management.joinRequests.push({requestId:crypto.randomUUID(),member});
    else addMember(member);
    emit();
  }
  function enter(displayName,isHost){
    self.profile.displayName=displayName;
    const names=[displayName,'Rafi’s laptop','Maya’s laptop','Alex’s laptop'];
    const members=names.map((displayName,i)=>({deviceId:['a1111111','b2222222','c3333333','d4444444'][i],profile:{displayName}}));
    state={self,isHost,roomNumber:'482916',pin:'1234',localIps:['192.168.137.1'],members,management:{manualApproval:true,joinRequests:[],sharingPermissions:Object.fromEntries(members.map(m=>[m.deviceId,true]))},modes:Object.fromEntries(members.map(m=>[m.deviceId,'collaborative'])),screens:members.map((m,i)=>({deviceId:m.deviceId,x:i*1920,y:0,w:1920,h:1080}))};emit();
  }
  window.odyssync={
    async createRoom(name){enter(name,true);return {roomNumber:state.roomNumber,pin:state.pin,localIps:state.localIps};},
    async joinRoom({roomNumber,pin,displayName,directIp}){if(pin!=='1234')return {ok:false,reason:'bad_pin'};if(!directIp&&roomNumber!=='482916')return {ok:false,reason:'no_room'};enter(displayName,false);return {ok:true};},
    async leaveRoom(){state={self,members:[],screens:[]};emit();},
    async setLayout(screens){if(!state.isHost)throw Error('Only the host can arrange screens.');state.screens=structuredClone(screens);emit();},
    async listSendable(deviceId){await new Promise(r=>setTimeout(r,300));return {ok:true,items:[{id:1,kind:'document',badge:'PDF',name:'Project brief.pdf',detail:'Project overview and requirements'},{id:2,kind:'document',badge:'FIG',name:'Website design.fig',detail:'Latest screens and design assets'},{id:3,kind:'file',badge:'ZIP',name:'Brand assets.zip',detail:'Logos, fonts and brand guidelines'}]};},
    async sendDirect({deviceId,itemId}){await new Promise(r=>setTimeout(r,600));return {ok:true,what:'file'};},
    async setMode(mode){if(!['focus','collaborative','approval'].includes(mode))throw Error('Unknown mode');state.modes={...state.modes,[self.deviceId]:mode};emit();},
    // Optional UI integration extension; the production bridge has not been built.
    management:{
      async setManualApproval(enabled){requireHost();if(!enabled&&state.management.joinRequests.length)throw Error('Resolve pending requests before turning off manual approvals.');state.management.manualApproval=enabled;emit();},
      async answerJoinRequest(requestId,accepted){requireHost();const request=state.management.joinRequests.find(r=>r.requestId===requestId);if(!request)throw Error('This request is no longer pending.');if(accepted)addMember(request.member);state.management.joinRequests=state.management.joinRequests.filter(r=>r.requestId!==requestId);emit();},
      async setSharingPermission(deviceId,allowed){requireHost();if(deviceId===self.deviceId)throw Error('The host keeps sharing access.');if(!state.members.some(m=>m.deviceId===deviceId))throw Error('This laptop has left the room.');state.management.sharingPermissions[deviceId]=allowed;emit();}
    },
    onState(fn){listeners.push(fn);fn(structuredClone(state));return()=>listeners=listeners.filter(f=>f!==fn);},
    onNotice(fn){notices.push(fn);return()=>notices=notices.filter(f=>f!==fn);}
  };
  // Manual preview checks from the browser console.
  window.previewControls={notice(kind,text){notices.forEach(fn=>fn({kind,text}));},removeLast(){state.members.pop();state.screens.pop();emit();},asMember(){state.isHost=false;emit();}};
  Object.assign(window.previewControls,{
    requestJoin,
    reconnectLast(){requireHost();const member=state.members.at(-1);if(!member||member.deviceId===self.deviceId)throw Error('No other laptop to reconnect.');state.members.pop();state.screens.pop();requestJoin(member);},
    canShare(deviceId){return state.members.some(m=>m.deviceId===deviceId)&&state.management.sharingPermissions[deviceId]===true;}
  });
  // Deterministic preview states for visual review; no production entry uses this file.
  window.addEventListener('DOMContentLoaded',async()=>{
    const scene=new URLSearchParams(location.search).get('scene');
    if(['room','requests','permissions'].includes(scene)){
      document.querySelector('#create').click();
      document.querySelector('form').requestSubmit();
      await Promise.resolve();
      if(scene==='requests')window.previewControls.reconnectLast();
      if(scene!=='room')document.querySelector('#'+scene).click();
    }else if(scene==='join') document.querySelector('#join').click();
    else if(scene==='create') document.querySelector('#create').click();
  });
})();
