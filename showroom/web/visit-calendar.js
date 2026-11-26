const VisitCalendar=(()=>{
  const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  const escape=value=>String(value??"").replace(/\\/g,"\\\\").replace(/\r\n|\r|\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;").replace(/[\x00-\x08\x0b-\x1f\x7f]/g,"");
  function fold(line){
    const encoder=new TextEncoder();
    let output="",bytes=0;
    for(const ch of line){
      const length=encoder.encode(ch).length;
      if(bytes+length>75){output+="\r\n ";bytes=1;}
      output+=ch;bytes+=length;
    }
    return output;
  }
  function create({confirmation,slot,vehicle,stock,dealer,address,host}){
    const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//AutoDealership.SI//Showroom//EN","BEGIN:VEVENT",
      "UID:"+escape(confirmation)+"@"+escape(host),"DTSTAMP:"+stamp(Date.now()),"DTSTART:"+stamp(slot),
      "DTEND:"+stamp(Date.parse(slot)+3600000),"SUMMARY:"+escape("Test drive · "+vehicle),
      "LOCATION:"+escape([dealer,address].filter(Boolean).join(", ")),
      "DESCRIPTION:"+escape([stock?"Stock #"+stock:"","Confirmation "+confirmation].filter(Boolean).join("\n")),
      "END:VEVENT","END:VCALENDAR"];
    return lines.map(fold).join("\r\n")+"\r\n";
  }
  return {create};
})();
