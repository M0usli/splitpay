"""Evaluation: measure how often the pipeline reads receipts correctly.

Run it with `python -m app.eval`. It reads test receipts and their correct
answers ("labels"), runs OCR and extraction on each one, and reports the
accuracy per field.
"""
