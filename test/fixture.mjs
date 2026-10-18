import http from 'node:http';
export async function fixtureServer({usageForRequest,outputForRequest}={}){
  const requests=[];let release;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const data of req)body+=data;
    const request=JSON.parse(body);requests.push(request);
    const last=[...(request.input||[])].reverse().find(item=>item.role==='user');
    const inputTokens=usageForRequest?usageForRequest(request,requests.length):JSON.stringify(last).includes('REPORT_HIGH_USAGE')?20000:120;
    if(JSON.stringify(last).includes('HOLD_FIXTURE'))await new Promise(resolve=>{release=resolve;});
    const number=requests.length;const message=outputForRequest?.(request,number)??{id:`msg_test_${number}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'LOCAL TEST OK',annotations:[]}]};
    const events=[{type:'response.created',response:{id:`resp_test_${number}`,object:'response',status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...message,status:'in_progress',...(message.type==='message'?{content:[]}:{arguments:''})}},
      ...(message.type==='message'?[{type:'response.output_text.delta',item_id:message.id,output_index:0,content_index:0,delta:'LOCAL TEST OK'}]:[{type:'response.function_call_arguments.delta',item_id:message.id,output_index:0,delta:message.arguments}]),
      {type:'response.output_item.done',output_index:0,item:message},
      {type:'response.completed',response:{id:`resp_test_${number}`,object:'response',status:'completed',output:[message],usage:{input_tokens:inputTokens,output_tokens:3,total_tokens:inputTokens+3,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}];
    const payload=events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    res.writeHead(200,{'Content-Type':'text/event-stream','Content-Length':Buffer.byteLength(payload)});res.end(payload);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,requests,port:server.address().port,release:()=>release?.(),held:()=>!!release};
}
