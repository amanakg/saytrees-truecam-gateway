console.log('hevcodec worker start........');

// self.Module = {
//     onRuntimeInitialized: function () {
//         onWasmLoaded();
//     }
// };

console.log('cpu count:'+navigator.hardwareConcurrency);

// importScripts('decoder_def.js');
// // importScripts('libffmpeg.worker.js');
// importScripts('libffmpeg.js');
 

function hevcDecoder()
{
    this.sdkptr=null;
    this.wasmLoaded = false;
    this.tmpReqQue = [];
    this.datacallback = null;
    this.onPictureDecoded = null;
    this.decoutputbuffer=0;
    this.rgb = true;

    this.UninitDecoder=function()
    {
        Module._Uninit_decoder(this.sdkptr);
        Module._free(this.sdkptr);
        Module._free(this.decoutputbuffer);
    }

    this.InitDecoder=function(hevc,rgb){
        this.sdkptr=Module._malloc(Module._sdkhandle_size());
        this.rgb = rgb;
        console.log(this.sdkptr);
        var that=this;
        // this.datacallback = function(ptr,data,size,isyuv,w,h,pts){
        //     if(that.onPictureDecoded)
        //     {
        //         var rtdata = Module.HEAPU8.subarray(data,data+size); 
        //         that.onPictureDecoded(rtdata,w,h,pts,0);
        //     }
        // }
        // var callback=Module.addFunction(this.datacallback,'viiiiiii');
        // // Module._init_decoder(this.sdkptr,navigator.hardwareConcurrency/2,hevc,rgb,callback);
        Module._init_decoder(this.sdkptr,1,hevc,rgb,null);

        this.decoutputbuffer = Module._malloc(3840*2160*4);
    }

    this.DirectDecode = function(frame) {
        //if(!this.decoutputbuffer)            
        var data = new Int32Array([0,0,0]);

        var nDataBytes = data.length * data.BYTES_PER_ELEMENT;
        var dataPtr = Module._malloc(nDataBytes);
        
        // Copy data to Emscripten heap (directly accessed from Module.HEAPU8)
        var dataHeap = new Uint8Array(Module.HEAPU8.buffer, dataPtr, nDataBytes);
        dataHeap.set(new Uint8Array(data.buffer));
        
        // Call function and get result
        
        // Free memory

        var decbuf = Module._malloc(frame.byteLength);
        Module.HEAPU8.set(frame,decbuf);
        Module._decode_frame(this.sdkptr,decbuf,frame.byteLength,this.decoutputbuffer,dataHeap.byteOffset);
        var result = new Int32Array(dataHeap.buffer, dataHeap.byteOffset, data.length);
        if(this.onPictureDecoded&&result[0]>0)
        {
            var rtdata = Module.HEAPU8.subarray(this.decoutputbuffer,this.decoutputbuffer+result[2]); 
            this.onPictureDecoded(rtdata,result[0],result[1],0,0);
        }
        Module._free(dataHeap.byteOffset);    
        // Module._free(outputbuf);
        Module._free(decbuf);
    }

    this.Decode = function(frame){
        var decbuf = Module._malloc(frame.byteLength);
        Module.HEAPU8.set(frame,decbuf);

        // console.log('this.Decode:'+frame.byteLength);
        //console.log(frame[0]+','+frame[1]+','+frame[2]+','+frame[3]+','+frame[4]+','+frame[5]+','+frame[6]+','+frame[7])
        Module._decode_buffer(this.sdkptr,decbuf,frame.byteLength);
        Module._free(decbuf);
    }

    this.processReq = function(req) {
        switch(req.cmd) {
            case JA_InitDecoderReq :
            this.InitDecoder();
            self.postMessage({cmd:JA_InitDecoderRsp});
            break;
            case JA_DecoderBufferReq: 
            this.Decode(req.data);
            //    self.postMessage({cmd:JA_DecodercompleteRsp});
            break;
        }
    }

    this.onWasmLoaded = function() {
    }

    this.cacheReq = function (req) {
        if (req) {
            this.tmpReqQue.push(req);
        }
    };


    self.decoder = null;

    self.onmessage = function(evt) {
        if (!self.decoder) {
            self.decoder = new hevcDecoder();
        }
        var req = evt.data;
        // if (!self.decoder.wasmLoaded) {
        //     self.decoder.cacheReq(req);
        //     console.log("Temp cache req " + req.cmd + ".");
        //     return;
        // }
        self.decoder.processReq(req);
    }

    function onWasmLoaded()
    {
        console.log("onWasmLoaded-------");
        // if(self.decoder){
        //     if(!self.decoder.wasmLoaded)
        //         self.decoder.onWasmLoaded();
        // }
        // else{
        //     console.log("no decoder loaded!");
        // }
    }

}
