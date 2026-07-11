# Live Model Evaluation

## 2026-07-12: LM Studio and Gemma 4 E4B

- Endpoint: `http://127.0.0.1:1234/v1`
- Model: `google/gemma-4-e4b`
- Fixture: `IMG_20210703_184219.jpg` from the local recipe-generation project
- Preprocessing: orientation correction, maximum 768 px, JPEG quality 80
- Response mode: strict JSON Schema
- Validated latency: 13.45 seconds

### What worked

- The endpoint advertised the requested model through `/v1/models`.
- The model accepted OpenAI-compatible multimodal chat input.
- The response passed Scranbook's runtime meal-analysis schema.
- The image was correctly classified as `recipe_card`.
- The dish title, “Smoky Chilli Con Carne With Rice”, was identified correctly.
- The result explicitly warned that recipe-card quantities do not prove what was consumed.
- A Playwright mobile test also passed through the real browser UI in 13.3 seconds after LM Studio
  was restarted on `127.0.0.1:1234` with its supported `--cors` option.

### Quality limitations observed

The ingredient list contained several OCR or inference errors. It invented or misread ingredients
such as garlic and onion while missing visible card items. This result is suitable as a draft, not a
trusted diary record. Scranbook must continue to show model results as editable estimates, preserve
uncertainty, and require user review before saving.

### Compatibility finding

This LM Studio version rejected `response_format.type: json_object` and accepted `json_schema` or
`text`. The verified development default is therefore strict JSON Schema, with tolerant text kept as
a configurable fallback for other OpenAI-compatible endpoints.

LM Studio had CORS disabled initially, so Node requests worked while browser discovery failed. The
verified browser-direct development command is:

```sh
lms server start --port 1234 --bind 127.0.0.1 --cors
```

The loopback bind keeps the server off the local network, although enabling CORS still means any
website open in the browser can attempt to call it. Authentication should be enabled if broader
access is required.
