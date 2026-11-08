import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch
from codenotch import runtimes
from codenotch.model import ProviderError
from codenotch.providers import Provider
from codenotch.worker import fetch_provider, DEFAULTS, OPT_IN

class Parsers(unittest.TestCase):
    def test_ollama_loaded_models(self):
        out=runtimes.ollama({'models':[{'name':'llama3:8b','size':1000,'size_vram':500,'context_length':8192,
            'expires_at':'2026-11-08T14:38:31Z','details':{'parameter_size':'8B','quantization_level':'Q4_0'}},'junk']},0)
        self.assertEqual(out['windows'],[])
        m=out['runtime']['models'][0]
        self.assertEqual((m['name'],m['gpu'],m['context'],m['params'],m['quant']),('llama3:8b',.5,8192,'8B','Q4_0'))
        self.assertIsNotNone(m['expiresAt'])
        with self.assertRaises(ProviderError): runtimes.ollama({'error':'x'},0)

    def test_lmstudio_v1_instances_and_v0_state(self):
        v1={'models':[{'type':'llm','key':'q','size_bytes':31457991680,'params_string':'27B','quantization':{'name':'Q8_K_XL'},
                       'loaded_instances':[{'id':'q','config':{'context_length':262144}},{'id':'q:2'}]},
                      {'type':'llm','key':'idle','loaded_instances':[]},{'type':'embedding','key':'e','loaded_instances':[{'id':'e'}]}]}
        names=[m['name'] for m in runtimes.lmstudio(v1,0)['runtime']['models']]
        self.assertEqual(names,['q','q:2'])
        v0={'data':[{'id':'a','type':'llm','state':'loaded','loaded_context_length':4096,'quantization':'Q4_K_M'},{'id':'b','type':'llm','state':'not-loaded'}]}
        models=runtimes.lmstudio(v0,0)['runtime']['models']
        self.assertEqual([(m['name'],m['context'],m['quant']) for m in models],[('a',4096,'Q4_K_M')])

    def test_speed_skips_prompt_processing(self):
        with tempfile.TemporaryDirectory() as home:
            log=Path(home)/'.lmstudio/server-logs/2026-11/2026-11-08.1.log';log.parent.mkdir(parents=True)
            log.write_text('I slot print_timing: id  0 | task 1 | prompt eval time =    3150.95 ms /  4122 tokens (    0.76 ms per token,  1308.18 tokens per second)\n'
                           'I slot print_timing: id  0 | task 1 |        eval time =   10359.54 ms /   415 tokens (   24.96 ms per token,    40.06 tokens per second)\n'
                           'I slot print_timing: id  0 | task 2 | prompt eval time =    1.00 ms /  10 tokens (    0.10 ms per token,  9999.00 tokens per second)\n')
            speed=runtimes.lmstudio_speed(home)
            self.assertEqual((speed['speed'],speed['tokens']),(40.1,415))

    def test_endpoints(self):
        with patch.dict('os.environ',{'OLLAMA_HOST':'0.0.0.0:11500'}): self.assertEqual(runtimes.ollama_base(),'http://127.0.0.1:11500')
        with patch.dict('os.environ',{'OLLAMA_HOST':'gpu-box.lan:11434'}): self.assertIsNone(runtimes.ollama_base())
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(runtimes.lmstudio_base(home),'http://127.0.0.1:1234')
            cfg=Path(home)/'.lmstudio/.internal/http-server-config.json';cfg.parent.mkdir(parents=True);cfg.write_text('{"port":4321}')
            self.assertEqual(runtimes.lmstudio_base(home),'http://127.0.0.1:4321')

class Loopback(unittest.TestCase):
    def serve(self,routes):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                code,body=routes.get(self.path,(404,{}))
                self.send_response(code);self.send_header('Content-Type','application/json');self.end_headers()
                self.wfile.write(json.dumps(body).encode())
            def log_message(self,*a):pass
        server=HTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        self.addCleanup(server.shutdown)
        return server.server_address[1]

    def test_lmstudio_falls_back_to_v0_and_reports_offline(self):
        port=self.serve({'/api/v0/models':(200,{'data':[{'id':'a','type':'llm','state':'loaded'}]})})
        with tempfile.TemporaryDirectory() as home, patch.object(runtimes,'lmstudio_base',return_value=f'http://127.0.0.1:{port}'):
            out=runtimes.fetch('lmstudio',home)
            self.assertEqual(out['runtime']['models'][0]['name'],'a')
        with patch.object(runtimes,'ollama_base',return_value='http://127.0.0.1:9'):
            with self.assertRaises(ProviderError) as err: runtimes.fetch('ollama','/tmp')
            self.assertEqual(err.exception.status,'offline')

    def test_token_required_is_not_a_sign_out_loop(self):
        port=self.serve({'/api/ps':(401,{})})
        with patch.object(runtimes,'ollama_base',return_value=f'http://127.0.0.1:{port}'):
            with self.assertRaises(ProviderError) as err: runtimes.fetch('ollama','/tmp')
            self.assertEqual(err.exception.status,'needsAuth')

    def test_only_loopback(self):
        with self.assertRaises(ProviderError): runtimes.loopback_json('http://192.168.1.2:11434/api/ps','Ollama')

class Worker(unittest.TestCase):
    def test_runtime_row_carries_models_and_short_cadence(self):
        p=Provider('ollama','Ollama','ollama',Path('/x'))
        with patch.object(Provider,'fetch',return_value={'windows':[],'runtime':{'models':[{'name':'m'}]}}):
            row=fetch_provider(p,{},{},dict(DEFAULTS),None,None,None)
        self.assertEqual(row['status'],'ok');self.assertEqual(row['runtime']['models'][0]['name'],'m')
        self.assertIn('1 model loaded',row['message'])
        self.assertLessEqual(row['nextPoll']-row['checkedAt'],runtimes.CADENCE+1)
        with patch.object(Provider,'fetch',side_effect=ProviderError('offline','Ollama is not running.')):
            row=fetch_provider(p,{},{'windows':[],'runtime':{'models':[{'name':'m'}]}},dict(DEFAULTS),None,None,None)
        self.assertEqual(row['status'],'offline');self.assertIsNone(row['runtime'])

    def test_runtimes_are_opt_in(self):
        self.assertIn('ollama',OPT_IN);self.assertIn('lmstudio',OPT_IN)

if __name__=='__main__': unittest.main()
