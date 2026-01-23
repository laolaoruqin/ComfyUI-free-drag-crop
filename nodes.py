import torch
import numpy as np
from PIL import Image

class FreeDragCrop:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "crop_left": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
                "crop_right": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
                "crop_top": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
                "crop_bottom": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
            },
            "optional": {
                "mask": ("MASK",),
                "aspect_ratio": ("STRING", {"default": "1:1"}),
                "ratio_lock": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "CROP_JSON")
    FUNCTION = "crop"
    CATEGORY = "image/process"

    def crop(self, image, crop_left, crop_right, crop_top, crop_bottom, mask=None, aspect_ratio="1:1", ratio_lock=False):
        # image shape: [B, H, W, C]
        _, h, w, _ = image.shape
        
        # Ensure crops are within bounds and logical
        left = max(0, min(w - 1, crop_left))
        right = max(left + 1, min(w, w - crop_right))
        top = max(0, min(h - 1, crop_top))
        bottom = max(top + 1, min(h, h - crop_bottom))
        
        # Slice image
        cropped_image = image[:, top:bottom, left:right, :]
        
        # Slice mask if exists
        cropped_mask = None
        if mask is not None:
            # mask shape: [B, H, W]
            cropped_mask = mask[:, top:bottom, left:right]
        else:
            # Create a full white mask of the cropped size
            cropped_mask = torch.ones((image.shape[0], bottom - top, right - left), dtype=torch.float32)

        crop_json = {
            "x": int(left),
            "y": int(top),
            "width": int(right - left),
            "height": int(bottom - top),
            "orig_width": int(w),
            "orig_height": int(h)
        }
        import json
        
        return (cropped_image, cropped_mask, json.dumps(crop_json))

NODE_CLASS_MAPPINGS = {
    "FreeDragCrop": FreeDragCrop
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FreeDragCrop": "Free Drag Crop (Interactive)"
}
