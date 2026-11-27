import io,unittest,ssl
from urllib.error import HTTPError
from preview_health import ready
class Response(io.BytesIO):
    def __init__(self,req,html,slug,status=200):
        self.url=req.full_url;self.status=status
        self.headers={"Content-Type":"text/html" if html else "application/javascript"}
        super().__init__((b'<h1 id="heroname">Example</h1>' if html else ('window.postgresInventory=true;window.clientSite={"slug":"'+slug+'"};window.CdjrInventory=[];').encode()))
    def geturl(self):return self.url
class PreviewTests(unittest.TestCase):
    def test_ready(self):
        def fetch(req,timeout):return Response(req,req.full_url.endswith("/"),"boyce-auto")
        self.assertTrue(ready("boyce-auto",fetch))
    def test_wrong_tenant_unavailable_and_bad_certificate(self):
        self.assertFalse(ready("boyce-auto",lambda req,timeout:Response(req,req.full_url.endswith("/"),"other-dealer")))
        self.assertFalse(ready("boyce-auto",lambda req,timeout:Response(req,True,"boyce-auto",503)))
        def bad(req,timeout):raise ssl.SSLCertVerificationError()
        self.assertFalse(ready("boyce-auto",bad))
    def test_redirect(self):
        def moved(req,timeout):
            r=Response(req,True,"boyce-auto");r.url="https://other.example/";return r
        self.assertFalse(ready("boyce-auto",moved))
if __name__=="__main__":unittest.main()
