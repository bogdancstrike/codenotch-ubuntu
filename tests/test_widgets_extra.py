import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from codenotch import widgets
from codenotch.worker import clamp_widgets, configuration

class ExtraWidgets(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
    def net(self,received,sent,name='eth0'):
        (self.root/'net').mkdir(exist_ok=True)
        (self.root/'net/dev').write_text('header\nheader\n'+f'{name}: {received} 0 0 0 0 0 0 0 {sent} 0 0 0 0 0 0 0\nlo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0\n')
    def test_network_requires_two_samples_and_handles_counter_resets(self):
        cache={};self.net(1000,2000)
        self.assertNotIn('download',widgets.network(cache,self.root,10))
        self.net(2000,2400)
        reading=widgets.network(cache,self.root,12)
        self.assertEqual(reading['download'],500);self.assertEqual(reading['upload'],200)
        self.assertEqual(reading['received'],2000);self.assertEqual(reading['interfaces'],['eth0'])
        self.net(1,1);self.assertNotIn('download',widgets.network(cache,self.root,13))
        self.net(10,10,'wlan0');self.assertNotIn('download',widgets.network(cache,self.root,14))
        self.assertNotIn('download',widgets.network(cache,self.root,1))
    def test_uptime_missing_and_valid(self):
        self.assertIsNone(widgets.uptime(self.root))
        (self.root/'uptime').write_text('90061.5 12345.0')
        self.assertEqual(widgets.uptime(self.root),{'seconds':90061})
        (self.root/'uptime').write_text('invalid');self.assertIsNone(widgets.uptime(self.root))
    def test_temperature_only_cpu_and_highest_valid_sensor(self):
        for name,driver,temp in [('cpu','coretemp','52000'),('gpu','amdgpu','90000'),('disk','nvme','75000')]:
            path=self.root/name;path.mkdir();(path/'name').write_text(driver);(path/'temp1_input').write_text(temp)
        (self.root/'cpu/temp2_input').write_text('62000');(self.root/'cpu/temp2_label').write_text('Package id 0')
        self.assertEqual(widgets.temperature(self.root),{'celsius':62,'sensor':'Package id 0'})
        (self.root/'cpu/temp2_input').write_text('999999');self.assertEqual(widgets.temperature(self.root)['celsius'],52)
    def test_load_swap_processes(self):
        self.assertIsNone(widgets.load(self.root));self.assertIsNone(widgets.processes(self.root));self.assertIsNone(widgets.swap(self.root))
        (self.root/'loadavg').write_text('1.50 0.75 0.25 3/412 9999\n')
        self.assertEqual(widgets.load(self.root)['five'],.75)
        self.assertEqual(widgets.processes(self.root),{'running':3,'total':412})
        (self.root/'meminfo').write_text('MemTotal: 100 kB\nSwapTotal: 2097152 kB\nSwapFree: 1048576 kB\n')
        self.assertEqual(widgets.swap(self.root),{'fraction':.5,'used':1.0,'total':2.0})
        (self.root/'meminfo').write_text('SwapTotal: 0 kB\nSwapFree: 0 kB\n')
        self.assertIsNone(widgets.swap(self.root)['fraction'])
    def test_disk_activity_counts_whole_disks_once(self):
        cache={}
        def stats(read,write):
            rows=[f'8 0 sda 1 0 {read} 0 1 0 {write} 0 0 0 0',f'8 1 sda1 1 0 {read} 0 1 0 {write} 0 0 0 0',
                  f'259 0 nvme0n1 1 0 {read} 0 1 0 {write} 0 0 0 0',f'259 1 nvme0n1p1 1 0 {read} 0 1 0 {write} 0 0 0 0',
                  '7 0 loop0 1 0 99999 0 1 0 99999 0 0 0 0']
            (self.root/'diskstats').write_text('\n'.join(rows))
        stats(0,0);self.assertEqual(widgets.diskio(cache,self.root,1),{'disks':['nvme0n1','sda']})
        stats(10,20);reading=widgets.diskio(cache,self.root,3)
        self.assertEqual((reading['read'],reading['write']),(10*512*2/2,20*512*2/2))
        stats(1,1);self.assertNotIn('read',widgets.diskio(cache,self.root,4))
    def test_wifi_picks_strongest_interface(self):
        self.assertIsNone(widgets.wifi(self.root));(self.root/'net').mkdir()
        (self.root/'net/wireless').write_text('h\nh\n wlan0: 0000   35.  -75.  -256 0 0 0 0 0 0\n wlan1: 0000   70.  -40.  -256 0 0 0 0 0 0\n')
        self.assertEqual(widgets.wifi(self.root),{'interface':'wlan1','quality':1.0,'signal':-40})
    def test_sun_shares_the_weather_request(self):
        reading={'temp':20,'sunrise':'07:01','sunset':'18:59','place':'Town','status':'ok','message':''}
        with patch.object(widgets,'weather',return_value=reading) as weather:
            out=widgets.collect({'widgets':['sun']},{})
            self.assertEqual(out,{'sun':{'sunrise':'07:01','sunset':'18:59','place':'Town','status':'ok','message':''}})
            out=widgets.collect({'widgets':['weather','sun']},{});self.assertEqual(weather.call_count,2);self.assertIn('weather',out)
        self.assertTrue(widgets.needs_network({'widgets':['sun']},{}))
        self.assertFalse(widgets.needs_network({'widgets':['utc','moon','progress']},{}))
        self.assertEqual(widgets._clock('2026-09-29T07:05'),'07:05');self.assertIsNone(widgets._clock(None))
    def test_clock_widgets_need_no_worker_reading(self):
        self.assertEqual(widgets.collect({'widgets':['utc','moon','progress']},{}),{})
    def test_six_widgets_survive_settings_validation(self):
        kinds=['cpu','memory','storage','network','uptime','temperature','load','swap','processes','diskio','wifi','sun','utc','moon','progress']
        self.assertEqual(clamp_widgets(kinds+['cpu','invalid']),kinds)
    def test_shared_system_sample_and_disabled_readers(self):
        with patch.object(widgets,'system',return_value={'cpu':.5}) as system, \
             patch.object(widgets,'network',side_effect=AssertionError('disabled')), \
             patch.object(widgets,'temperature',side_effect=AssertionError('disabled')), \
             patch.object(widgets,'uptime',side_effect=AssertionError('disabled')):
            out=widgets.collect({'widgets':['system','cpu','memory','storage']},{})
            self.assertEqual(set(out),{'system','cpu','memory','storage'});system.assert_called_once()
        with patch.object(widgets,'system',side_effect=AssertionError('disabled')):
            self.assertEqual(widgets.collect({'widgets':[]},{}),{})

    def test_settings_theme_defaults_and_validation(self):
        self.assertEqual(configuration(self.root)['settingsTheme'],'system')
        folder=self.root/'codenotch';folder.mkdir()
        for value,expected in [('light','light'),('dark','dark'),('system','system'),('invalid','system'),(None,'system')]:
            (folder/'settings.json').write_text(json.dumps({'settingsTheme':value}))
            self.assertEqual(configuration(self.root)['settingsTheme'],expected)
