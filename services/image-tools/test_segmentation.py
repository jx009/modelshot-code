"""No model downloads; run: python -m unittest discover -s services/image-tools."""
import io
import unittest
from unittest.mock import Mock
from collections import OrderedDict
import numpy as np
from PIL import Image
from fastapi import HTTPException
import app
from segmentation import Segmenter


class SegmentationTests(unittest.TestCase):
    def test_embedding_is_reused_and_cache_is_bounded(self):
        engine = Segmenter.__new__(Segmenter)
        engine.cache, engine.cache_size, engine.ttl = OrderedDict(), 1, 600
        engine.encoder = Mock()
        engine.encoder.get_outputs.return_value = [Mock(name="image_embeddings")]
        engine.encoder.run.return_value = [np.zeros((1, 1), dtype=np.float32)]
        source = Image.new("RGB", (100, 50))
        first, cached = engine.embedding(source, b"first")
        self.assertFalse(cached)
        again, cached = engine.embedding(source, b"first")
        self.assertTrue(cached); self.assertIs(first, again)
        engine.embedding(source, b"second")
        self.assertEqual(len(engine.cache), 1)
        self.assertEqual(engine.encoder.run.call_count, 2)

    def test_box_prompt_restores_non_square_image_and_limits_to_selection(self):
        engine = Segmenter.__new__(Segmenter)
        engine.embedding = Mock(return_value=({"resized": (1024,512)}, True))
        masks = np.full((1, 3, 256, 256), -10, dtype=np.float32)
        masks[0,1,:128] = 10
        engine.predict = Mock(return_value=(masks,np.array([[0.1,0.9,0.2]])))
        source = Image.new("RGBA", (100,50), "red")
        selection = Image.new("L", source.size)
        selection.paste(255,(10,5,80,45))
        result = engine.select(source,b"image",selection)
        self.assertEqual(result.getchannel("A").getbbox(),(10,5,80,45))
        self.assertEqual(engine.predict.call_args[0][2],[[2,3]])
        self.assertFalse(hasattr(Segmenter, "objects"))

    def test_wrong_size_selection_is_rejected_before_expensive_model(self):
        source, selection = io.BytesIO(), io.BytesIO()
        Image.new("RGB", (100,100)).save(source,"PNG")
        Image.new("RGB", (1,1)).save(selection,"PNG")
        fake = Mock(); app.ENGINES["segment"] = fake
        try:
            with self.assertRaises(HTTPException) as context:
                app.process("segment",source.getvalue(),{},selection.getvalue())
            self.assertEqual(context.exception.status_code,422)
            fake.select.assert_not_called()
        finally:
            app.ENGINES.clear()


if __name__ == "__main__":
    unittest.main()
