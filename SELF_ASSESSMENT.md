# Self-Assessment

> **Project:** Sejuk Sejuk Service — Internal Operations System  
> **Candidate Assessment:** Module 1 (Admin Portal · Order Submission) & Operations Query Window

---

## 1. Which module was easiest?

**Module 1: Admin Portal · Order Submission**

I chose to complete **Module 1** because it aligns closely with real-world administrative tasks and business workflows I have built in my previous work. Because of this familiarity, it was straightforward to map out the data models, state transitions, and form validation requirements, making it seamless to integrate into my AI-based development workflow.

---

## 2. What would you improve in a real production system?

**Enterprise Identity & Single Sign-On (SSO)**

In a real production environment, the primary area I would enhance is the authentication and identity tier:

- **Cloud Identity Integration:** Integrate an enterprise cloud-based identity provider, such as **Microsoft Entra ID (Azure AD)**, Google Workspace, or an equivalent **OAuth 2.0 / OIDC** solution.
- **Workflow & Access Management:** Utilizing an existing enterprise directory streamlines onboarding and offboarding, ensures centralized multi-factor authentication (MFA), and eliminates local credential management.
- **Client Alignment:** Most corporate and enterprise clients already standardize on established identity providers; plugging directly into their existing infrastructure significantly improves security, compliance, and user convenience.

---

## 3. How did you use AI tools while building this project?

**Multi-Agent Collaborative Workflow**

I used multiple AI models and specialized agent harnesses across different stages of the development lifecycle:

1. **Architecture & Specification (`gpt-6.1-sol`):**
   - In one agent harness, I ran `gpt-6.1-sol` to facilitate a two-way collaborative design discussion.
   - Together, we planned detailed technical specifications for each core sub-system of Module 1 (including session-based authentication, the order submission form, draft reconciliation, and order listing/pagination).
   - This produced comprehensive, production-ready specifications that guided downstream implementation.

2. **Targeted Implementation & Tweaks (Antigravity with `gemini-3.8-flash`):**
   - For focused execution, smaller tasks, and scenarios with token-limit constraints, I switched to **Antigravity** powered by `gemini-3.8-flash`.
   - I used it to implement targeted frontend and backend refinements, as well as to build out **Spec 5 (Operations Query Window)**.

3. **Context Engineering ([`AGENTS.md`](./AGENTS.md) & [`DESIGN.md`](./DESIGN.md)):**
   - Establishing structured context files—specifically [`AGENTS.md`](./AGENTS.md) and [`DESIGN.md`](./DESIGN.md)—was essential. They provided strict boundaries, domain rules, and architecture principles that kept the agents aligned and ensured the final product met all production-grade expectations.
