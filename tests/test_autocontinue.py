import argparse
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from codenotch import autocontinue as ac
from codenotch.worker import apply_settings, info_snapshot

HOUR=3600

def session(key='claude#abc',state='idle',tmux=None,resume=('claude','-p','--resume','abc')):
    return dict(name='proj',detail='~/proj',state=state,key=key,
                target=dict(kind='claude',pid=None,start=None,cwd='/tmp',tmux=tmux,resume=list(resume) if resume else None))

def rows(*sessions,windows=()):
    return [dict(id='claude',enabled=True,windows=list(windows),sessions=list(sessions))]

class Scheduling(unittest.TestCase):
    def setUp(self):
        self.sent=[]
        self.send=lambda key,t,prompt:(self.sent.append((key,prompt)),dict(ok=True,via='tmux'))[1]
        self.settings=dict(autoContinue={'claude#abc':1000.0},autoContinueMinutes=60,autoContinuePrompt='go on')

    def test_off_by_default_and_target_never_leaks(self):
        r=rows(session())
        ac.evaluate(r,dict(autoContinue={}),{},5000,self.send)
        s=r[0]['sessions'][0]
        self.assertNotIn('target',s)
        self.assertEqual(s['autoContinue'],dict(available=True,on=False,via='resume'))
        self.assertEqual(self.sent,[])

    def test_waits_one_interval_of_idleness_then_nudges(self):
        memory=ac.evaluate(rows(session()),self.settings,{},1000+HOUR-1,self.send)
        self.assertEqual(self.sent,[])
        memory=ac.evaluate(rows(session()),self.settings,memory,1000+HOUR,self.send)
        self.assertEqual(self.sent,[('claude#abc','go on')])
        # Not again until another full interval.
        ac.evaluate(rows(session()),self.settings,memory,1000+2*HOUR-1,self.send)
        self.assertEqual(len(self.sent),1)

    def test_activity_restarts_the_interval(self):
        memory=ac.evaluate(rows(session(state='busy')),self.settings,{},1000+HOUR,self.send)
        memory=ac.evaluate(rows(session()),self.settings,memory,1000+HOUR+10,self.send)
        self.assertEqual(self.sent,[])
        ac.evaluate(rows(session()),self.settings,memory,1000+2*HOUR,self.send)
        self.assertEqual(len(self.sent),1)

    def test_waiting_for_input_is_never_typed_into(self):
        ac.evaluate(rows(session(state='waiting')),self.settings,{},1000+5*HOUR,self.send)
        self.assertEqual(self.sent,[])

    def test_exhausted_limit_defers_until_reset(self):
        weekly=dict(id='weekly',fraction=1.0,resetsAt=1000+3*HOUR)
        r=rows(session(),windows=[weekly])
        memory=ac.evaluate(r,self.settings,{},1000+2*HOUR,self.send)
        self.assertEqual(self.sent,[])
        self.assertEqual(r[0]['sessions'][0]['autoContinue']['next'],1000+3*HOUR+ac.RESET_GRACE)
        # Once the window resets the cache drops it; the nudge is due at once.
        ac.evaluate(rows(session()),self.settings,memory,1000+3*HOUR+ac.RESET_GRACE,self.send)
        self.assertEqual(len(self.sent),1)

    def test_overage_does_not_block(self):
        r=rows(session(),windows=[dict(id='s',fraction=1.2,resetsAt=99999,overageAllowed=True)])
        ac.evaluate(r,self.settings,{},1000+HOUR,self.send)
        self.assertEqual(len(self.sent),1)

    def test_no_route_is_unavailable_and_never_sent(self):
        r=rows(session(resume=None))
        ac.evaluate(r,self.settings,{},1000+5*HOUR,self.send)
        self.assertFalse(r[0]['sessions'][0]['autoContinue']['available'])
        self.assertEqual(self.sent,[])

    def test_running_headless_child_blocks_a_second_nudge(self):
        memory={'sessions':{'claude#abc':dict(last=0,child=os.getpid(),childStart=ac.proc_start(os.getpid()))}}
        r=rows(session())
        ac.evaluate(r,self.settings,memory,1000+5*HOUR,self.send)
        self.assertEqual(self.sent,[])
        self.assertTrue(r[0]['sessions'][0]['autoContinue']['running'])

    def test_switching_off_forgets_memory(self):
        memory=ac.evaluate(rows(session()),self.settings,{},1000,self.send)
        self.assertIn('claude#abc',memory['sessions'])
        memory=ac.evaluate(rows(session()),dict(autoContinue={}),memory,2000,self.send)
        self.assertEqual(memory['sessions'],{})

class Commands(unittest.TestCase):
    def test_claude_mirrors_only_user_flags(self):
        cmd=ac.resume_command('claude','abc-1',['claude','--dangerously-skip-permissions','--model','opus','--foo'])
        self.assertEqual(cmd,['claude','-p','--resume','abc-1','--dangerously-skip-permissions','--model','opus'])
        self.assertEqual(ac.resume_command('claude','abc',['claude']),['claude','-p','--resume','abc'])

    def test_codex_maps_tui_flags_to_exec(self):
        cmd=ac.resume_command('codex','t1',['codex','--full-auto','-m','gpt-5'])
        self.assertEqual(cmd,['codex','exec','resume','--skip-git-repo-check','-c','sandbox_mode="workspace-write"','-m','gpt-5','t1'])
        self.assertIn('--dangerously-bypass-approvals-and-sandbox',ac.resume_command('codex','t1',['codex','--yolo']))

    def test_unsafe_ids_and_other_tools_have_no_resume(self):
        self.assertIsNone(ac.resume_command('claude','--evil',[]))
        self.assertIsNone(ac.resume_command('claude','a b',[]))
        self.assertIsNone(ac.resume_command('grok','abc',[]))

    def test_prompt_is_one_line_and_not_a_flag(self):
        self.assertEqual(ac.clean_prompt('--continue\nnow'),'continue now')
        self.assertEqual(ac.clean_prompt('   '),ac.DEFAULT_PROMPT)
        self.assertEqual(ac.clean_minutes(45),60);self.assertEqual(ac.clean_minutes(120),120)

    def test_program_sees_through_launchers(self):
        self.assertEqual(ac.program(['/usr/bin/node','/usr/lib/node_modules/@openai/codex/bin/codex.js','--yolo']),'codex')
        self.assertEqual(ac.program(['/home/u/.local/bin/claude']),'claude')

    def test_resume_runs_detached_in_session_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            script=Path(tmp)/'claude';script.write_text('#!/bin/sh\necho "$PWD|$@"\n');script.chmod(0o700)
            log=Path(tmp)/'logs/x.log'
            with patch.object(ac,'executable',return_value=str(script)):
                result=ac.deliver(dict(cwd=tmp,resume=['claude','-p','--resume','abc'],tmux=None),'go on',log)
            self.assertTrue(result['ok']);self.assertEqual(result['via'],'resume')
            import time
            for _ in range(100):
                if not ac.alive(result['child'],result['childStart']): break
                time.sleep(.02)
            self.assertEqual(log.read_text().strip(),f'{tmp}|-p --resume abc go on')
            self.assertEqual(log.stat().st_mode&0o777,0o600)

    def test_failed_delivery_is_reported_not_raised(self):
        with patch.object(ac,'executable',return_value=None):
            result=ac.deliver(dict(cwd='/',resume=['claude','-p'],tmux=['/tmp/s','%1']),'x',Path('/nonexistent/x.log'))
        self.assertFalse(result['ok']);self.assertIn('tmux',result['error']);self.assertIn('resume',result['error'])

class Settings(unittest.TestCase):
    def test_toggle_round_trip_and_cached_switch_follows(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=Path(tmp)/'config';root=Path(tmp)/'cache'
            args=lambda key,state:argparse.Namespace(set=None,enable=None,disable=None,location=None,auto_continue=[key,state])
            s=apply_settings(args('claude#abc','on'),config,root)
            self.assertIn('claude#abc',s['autoContinue'])
            self.assertEqual(json.loads((config/'codenotch/settings.json').read_text())['autoContinueMinutes'],60)
            cached={'claude':dict(id='claude',sessions=[dict(key='claude#abc',autoContinue=dict(on=False,available=True))])}
            class P:
                id='claude';kind='claude';path=Path('/x')
                def meta(self):return dict(id='claude',name='Claude',kind='claude')
            snap=info_snapshot([P()],s,cached,{})
            self.assertTrue(snap['providers'][0]['sessions'][0]['autoContinue']['on'])
            s=apply_settings(args('claude#abc','off'),config,root)
            self.assertEqual(s['autoContinue'],{})
            with self.assertRaises(ValueError): apply_settings(args('bad key!','on'),config,root)

if __name__=='__main__': unittest.main()
