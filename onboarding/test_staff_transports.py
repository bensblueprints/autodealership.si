"""Exercise a real TLS SMTP exchange with a loopback-only mail receiver."""
import base64,contextlib,email,io,socket,socketserver,ssl,subprocess,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
import staff_mail_transport as mail
class WireTest(unittest.TestCase):
    def test_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            cert=Path(tmp)/"cert";key=Path(tmp)/"key"
            subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-keyout",str(key),"-out",str(cert),"-days","1","-subj","/CN=mail.example.test","-addext","subjectAltName=DNS:mail.example.test"],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            server=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);server.load_cert_chain(cert,key)
            receipts=[]
            class Receiver(socketserver.StreamRequestHandler):
                def handle(self):
                    self.wfile.write(b"220 test SMTP\r\n")
                    while line:=self.rfile.readline():
                        word=line.split()[0].upper()
                        if word==b"EHLO":self.wfile.write(b"250-test\r\n250 AUTH PLAIN\r\n")
                        elif word==b"AUTH":
                            assert base64.b64decode(line.split()[2])==b"\x00marty@example.test\x00unit-fixture"
                            self.wfile.write(b"235 Authenticated\r\n")
                        elif word==b"DATA":
                            self.wfile.write(b"354 Continue\r\n");body=[]
                            while (piece:=self.rfile.readline())!=b".\r\n":body.append(piece)
                            receipts.append(email.message_from_bytes(b"".join(body)));self.wfile.write(b"250 Queued\r\n")
                        elif word==b"QUIT":self.wfile.write(b"221 Bye\r\n");break
                        else:self.wfile.write(b"250 OK\r\n")
            with socketserver.TCPServer(("127.0.0.1",0),Receiver) as sink:
                sink.socket=server.wrap_socket(sink.socket,server_side=True)
                t=threading.Thread(target=sink.handle_request,daemon=True);t.start()
                cred={"address":"marty@example.test","password":"unit-fixture","smtp":"mail.example.test","port":465,"kind":"imap"}
                letter=mail.message("<test-123@example.test>",cred["address"],"shopper@example.test","Your test drive","Friday works.")
                with patch.object(mail,"CTX",ssl.create_default_context(cafile=str(cert))),patch.object(mail,"dial",lambda host,port,timeout:socket.create_connection(sink.server_address,timeout=timeout)):
                    receipt,thread=mail.send(cred,letter)
                t.join(5);self.assertEqual(receipt,letter["Message-ID"]);self.assertEqual(len(receipts),1);self.assertEqual(receipts[0]["From"],cred["address"]);self.assertEqual(receipts[0]["To"],"shopper@example.test")
                self.assertIn("Friday works.",receipts[0].get_payload())
if __name__=="__main__":unittest.main()
