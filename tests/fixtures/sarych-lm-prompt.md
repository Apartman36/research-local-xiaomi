# Role

You are a senior ML infrastructure engineer specializing in PyTorch, CUDA, NVIDIA Blackwell GPUs, WSL2, and small language model training on consumer hardware.

# Context

I am preparing a local machine learning project called SARYCH-LM. It is a small English-only language model trained from scratch first, with distillation and larger variants planned later.

# Project roadmap

- Build a tiny proof-of-concept Transformer.
- Train a baseline model from scratch.
- Add checkpointing, evaluation, and reproducible runs.
- Distill from a stronger teacher model after the baseline works.
- Consider larger variants only after memory and data limits are understood.

# Hardware

- NVIDIA Blackwell GPU on Windows with WSL2.
- CUDA-capable PyTorch training.
- Local storage and consumer workstation constraints.

# Current project constraints

- English-only model for the MVP.
- Training must run locally.
- Prefer PyTorch.
- Avoid distributed cluster assumptions.
- Keep dependencies practical for WSL2.

# Research task

Research the current practical plan for building and training SARYCH-LM from scratch, then adding distillation.

# Questions to answer

1. What PyTorch, CUDA, NVIDIA Blackwell, and WSL2 versions should be used?
2. What model size is realistic for a local small English-only LM MVP?
3. What datasets and token budget should be used first?
4. What tokenizer strategy and vocabulary size should be selected?
5. What minimal Transformer architecture should be implemented?
6. What training loop, checkpointing, mixed precision, and memory optimizations are required?
7. What evaluation metrics and benchmarks make sense for a small local LM?
8. What distillation strategy should come after baseline pretraining?
9. What are the biggest risks and failure modes?
10. What implementation roadmap should be followed?

# Candidate dependencies

- PyTorch
- CUDA toolkit
- Hugging Face tokenizers
- safetensors
- datasets
- tqdm
- numpy

# Expected output format

- Recommended software versions.
- Hardware and memory assumptions.
- Model and tokenizer recommendation.
- Dataset plan.
- Training/checkpointing plan.
- Evaluation plan.
- Distillation plan.
- Risks and mitigations.
- Step-by-step implementation roadmap.

# Important

- Do not assume cloud training.
- Avoid vague best-practice advice.
- Prefer official docs and working open-source examples.
