export function createLanguagePreview() {
  let stop = () => {};
  function cancel() { stop(); stop=()=>{}; }
  function play({url,text,lang,onError,onEnd}) {
    cancel();
    let alive=true;
    let audio=null;
    let utterance=null;
    let timer=null;
    stop=()=>{ alive=false;clearTimeout(timer); if(audio){audio.pause();audio.onerror=null;audio.onended=null;audio.removeAttribute('src');}if(utterance){utterance.onerror=null;utterance.onend=null;window.speechSynthesis?.cancel();} };
    const fail=()=>{if(alive)onError?.('Không phát được bản nghe thử. Nội dung bản dịch vẫn được giữ; bạn có thể thử lại.');};
    const done=()=>{if(alive)onEnd?.();};
    function speak() {
      if(!alive)return;
      if(!text || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined'){fail();return;}
      utterance=new SpeechSynthesisUtterance(text);utterance.lang=lang;
      utterance.onend=done;utterance.onerror=fail;
      window.speechSynthesis.cancel();
      timer=setTimeout(()=>{if(alive){try{window.speechSynthesis.speak(utterance);}catch{fail();}}},100);
    }
    if(url && /^https?:/i.test(url)) {
      audio=new Audio(url);audio.onended=done;audio.onerror=fail;
      try{Promise.resolve(audio.play()).catch(fail);}catch{fail();}
    } else speak();
  }
  return {play,cancel};
}

export function audioReadiness(translation) {
  const playable=!!translation?.ttsUrl && /^https?:/i.test(translation.ttsUrl);
  if(playable && translation.ttsPrerendered) return 'Đã có tệp âm thanh';
  if(playable) return 'Có bản nghe thử · chưa xác nhận âm thanh offline';
  return 'Nghe thử bằng giọng trên thiết bị · chưa có tệp âm thanh';
}
