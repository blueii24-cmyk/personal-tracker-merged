"""Regression tests for the emulator smoke-test selectors, without a device."""
import importlib.util
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('android_ui_smoke', Path(__file__).with_name('android-ui-smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
PKG = smoke.PKG


def node(cls, *, text='', desc='', package=PKG, bounds='[10,20][300,80]'):
    return ET.Element('node', {'class': cls, 'text': text, 'content-desc': desc, 'package': package, 'bounds': bounds})


def hierarchy(*nodes):
    root = ET.Element('hierarchy')
    root.extend(nodes)
    return root


class SelectorsTest(unittest.TestCase):
    def test_chat_navigation_requires_exact_visible_app_node(self):
        root = hierarchy(node('android.view.View', text='AI Chat'),
                         node('android.view.View', text='Chat', package='other.package'),
                         node('android.view.View', text='Chat', bounds='[0,0][0,0]'),
                         node('android.view.View', desc='Chat'))
        self.assertIs(smoke.exact_match(root, 'Chat'), root[-1])

    def test_navigation_transition_cannot_select_overview_input(self):
        overview_input = node('android.widget.EditText')
        overview = hierarchy(overview_input, node('android.widget.TextView', text='Overview'))
        self.assertIsNone(smoke.edit_field(overview))
        chat_input = node('android.widget.EditText')
        chat = hierarchy(node('android.widget.Button', text='Conversations'), chat_input)
        self.assertIs(smoke.edit_field(chat), chat_input)

    def test_wait_for_chat_input_waits_until_navigation_completes(self):
        overview = hierarchy(node('android.widget.EditText'))
        chat_input = node('android.widget.EditText')
        chat = hierarchy(node('android.widget.Button', text='Conversations'), chat_input)
        with patch.object(smoke, 'hierarchy', side_effect=[overview, chat]), patch.object(smoke.time, 'sleep'):
            self.assertIs(smoke.wait_for(smoke.edit_field, 'chat', timeout=5), chat_input)

    def test_draft_text_is_not_counted_as_a_sent_message(self):
        draft = node('android.widget.EditText', text='hello')
        root = hierarchy(draft)
        self.assertIsNone(smoke.sent_message(root, 'hello'))
        message = node('android.widget.TextView', text='hello')
        root.append(message)
        self.assertIs(smoke.sent_message(root, 'hello'), message)

    def test_native_title_check_does_not_reject_web_document_title(self):
        webview = node('android.webkit.WebView', text='Personal Tracker')
        smoke.no_native_title(hierarchy(webview))
        with self.assertRaises(AssertionError):
            smoke.no_native_title(hierarchy(node('android.widget.TextView', text='Personal Tracker')))


if __name__ == '__main__':
    unittest.main()
