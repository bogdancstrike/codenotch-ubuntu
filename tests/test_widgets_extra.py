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
    def test_six_widgets_survive_settings_validation(self):
        kinds=['cpu','memory','storage','network','uptime','temperature']
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
