"""Convertit les voix MMS-TTS de Meta (fon, yoruba, bariba, dendi) en ONNX allégé pour l'API (src/tts).

Allègement : poids en entiers 8 bits partout sauf dans le décodeur audio et le prédicteur de durées (les
parties sensibles : la voix reste quasi identique à l'originale), 75 Mo par langue au lieu de 115.
Usage : python3 -m venv .venv-tts && .venv-tts/bin/pip install torch transformers onnx onnxruntime
        .venv-tts/bin/python scripts/tts/export_onnx.py out/   → out/{fon,yor,bba,ddn}.onnx
Publication : release GitHub « tts-models-v1 » (TTS_MODELS_URL). Licence des modèles : CC-BY-NC 4.0 (Meta).
"""
import os, sys, json, torch, onnx
from transformers import VitsModel, AutoTokenizer
from onnxruntime.quantization import quantize_dynamic, QuantType

out = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(out, exist_ok=True)
for lang in ('fon', 'yor', 'bba', 'ddn'):
    m = VitsModel.from_pretrained(f'facebook/mms-tts-{lang}').eval()
    tok = AutoTokenizer.from_pretrained(f'facebook/mms-tts-{lang}')
    json.dump({'vocab': tok.get_vocab(), 'addBlank': tok.add_blank, 'samplingRate': m.config.sampling_rate},
              open(f'src/tts/vocab/{lang}.json', 'w'), ensure_ascii=False)

    class Wave(torch.nn.Module):
        def __init__(self, m): super().__init__(); self.m = m
        def forward(self, input_ids): return self.m(input_ids=input_ids).waveform

    fp32 = f'{out}/{lang}.fp32.onnx'
    torch.onnx.export(Wave(m), (tok('test', return_tensors='pt').input_ids,), fp32, input_names=['input_ids'],
                      output_names=['waveform'], dynamic_axes={'input_ids': {1: 'n'}, 'waveform': {1: 's'}}, opset_version=17, dynamo=False)
    keep = [n.name for n in onnx.load(fp32).graph.node if '/decoder/' in n.name or '/duration_predictor/' in n.name]
    quantize_dynamic(fp32, f'{out}/{lang}.onnx', weight_type=QuantType.QUInt8, nodes_to_exclude=keep)
    os.remove(fp32)
    print(lang, round(os.path.getsize(f'{out}/{lang}.onnx') / 1e6, 1), 'Mo')
