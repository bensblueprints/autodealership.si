const InquiryContact=(()=>{
  const version="inquiry-text-reply-v1";
  const disclosure="I would like this dealership to text me about this inquiry at the number provided. Optional. Message and data rates may apply.";
  function phoneNumber(input){
    if(typeof input!=="string" || !/^\+?[0-9 ()-]+$/.test(input.trim()))return "";
    const digits=input.replace(/\D/g,"").replace(/^1(?=\d{10}$)/,"");
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)?"+1"+digits:"";
  }
  function request(input,timestamp){
    if(input.textReplyVersion!==version || input.requestTextReply!==true || input.source==="Voice concierge")return null;
    const number=phoneNumber(input.phone);
    if(!number)throw Error("Enter a US or Canadian mobile number for your text reply.");
    return {version,disclosure,number,requestedAt:timestamp,purpose:"vehicle-inquiry",channel:"web-form"};
  }
  return {version,disclosure,phoneNumber,request};
})();
