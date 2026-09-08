# Paseo Math

Markdown and LaTeX rendering for math-bearing assistant responses in Paseo, with inline formulas, display equations, and a **Copy source** action that preserves the original Markdown and TeX.

## Compatibility

Use **Paseo `0.8.0-beta.1` or later in the 0.8 series on both the host daemon and the client app**. The current plugin release, `v0.1.0-beta.3`, was validated against `0.8.0-beta.1`.

Upgrading a host does not upgrade its Android, desktop, or other client apps. A Paseo `0.7.2` client cannot load the current plugin and can report:

```text
Module "@getpaseo/plugin/client/react-native" is not available in plugin client code
```

Update the client to the matching 0.8 release rather than installing the plugin again. Official clients are available from the [Paseo releases page](https://github.com/getpaseo/paseo/releases).

For a host and client still on Paseo `0.7.2`, use [Math `v0.1.0-beta.2`](https://github.com/q5m-ai/paseo-math/releases/tag/v0.1.0-beta.2), not the current release.

## Install

Plugins are trusted code: they execute on the host and inside the client app without sandboxing. Install only code you trust.

You need Git, Node.js **22.22 or newer**, npm, and the **Paseo 0.8 CLI** on the host, with its Paseo daemon running.

1. In the app, select the host where your agent runs, open **Settings → Plugins**, and turn on **Enable plugins**.
2. In a terminal on that host, run:

   ```sh
   paseo plugin install https://github.com/q5m-ai/paseo-math.git --ref v0.1.0-beta.3
   paseo plugin ls
   ```

   Use your usual authenticated Paseo connection if the host requires a password. Paseo clones the pinned release and runs its dependency installation and build automatically—no manual clone, build, or directory entry is needed.
3. Confirm `q5m-math` is **running**, then ask an agent on that host for a math response.

Install once per host, not per agent or phone. If `q5m-math` is already installed and enabled, skip installation. After updating the client app, reconnect and use **Reload** on the plugin if needed.

## Writing math

Use `\(...\)` for inline math and `\[...\]` or `$$...$$` for display math. Ask the agent to return Markdown with LaTeX, **without wrapping its response in a code fence**; code remains literal.

For example, ask:

> Show the Pythagorean theorem as a display equation using LaTeX delimiters. Do not put the response in a code fence.

Expected response source:

```markdown
### Pythagorean theorem

$$
a^2 + b^2 = c^2
$$
```

The examples below use display-math blocks that also render on GitHub. Open the README's source to copy their Markdown and LaTeX directly.

## Mathematics

### Pythagorean theorem

$$
a^2 + b^2 = c^2
$$

### Fundamental theorem of calculus

$$
\int_a^b f'(x)\,dx = f(b) - f(a)
$$

### Euler's identity

$$
e^{i\pi} + 1 = 0
$$

## Physics

### Newton's second law

$$
\mathbf{F}_{\mathrm{net}} = ma
$$

### Newton's universal gravitation

$$
F = G\frac{m_1 m_2}{r^2}
$$

### Maxwell's equations

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \mathbf{B} &= 0 \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{B} &= \mu_0\mathbf{J} + \mu_0\varepsilon_0\frac{\partial \mathbf{E}}{\partial t}
\end{aligned}
$$

### Einstein's mass–energy equivalence

$$
E_0 = mc^2
$$

### Einstein's field equations

$$
G_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4}T_{\mu\nu}
$$

### Schrödinger's equation

$$
i\hbar\frac{\partial}{\partial t}\Psi = \hat{H}\Psi
$$

## Copying and rendering limits

- The upper-right copy icon (**Copy source** for screen readers) copies the original source supplied to that plugin item. Paseo can split a response into native Markdown blocks, so this is not a guarantee of copying the entire assistant turn; multiple copy actions can appear in one response.
- Invalid or oversized formulas fall back to source rather than replacing the response with a rendering error.
- Plugin startup on a host does not prove that every connected client can render it. Check the client version and the plugin's status in that client when diagnosing missing math.
