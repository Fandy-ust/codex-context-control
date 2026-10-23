# Third-party components / 第三方组件

The project’s original code is available under the [MIT License](LICENSE). This does not replace third-party licenses.

项目原创代码使用 [MIT 许可证](LICENSE) 开放；第三方组件的许可证保持不变。

| Component | License / notices |
| --- | --- |
| Windows Setup LZMA2 decoder (`7zr.exe` 26.05) | Public domain, from Igor Pavlov's [LZMA SDK](https://www.7-zip.org/sdk.html). Pinned SHA-256: `9bf582b894dfa665f852d7e9112b02290a1c303c2d95a21fcdc41ffcb03143b7`. Embedded only in Setup and removed with temporary extraction files; no separate installation required. |
| Node.js, bundled with the Mac installer | Node’s license and third-party notices are shipped in `vendor/Node-LICENSE.txt` and retained in the installed runtime directory. |
| js-tiktoken and its production dependencies | MIT; js-tiktoken’s upstream license is in `third-party-licenses/js-tiktoken.txt`. Other production dependency licenses remain in `node_modules/` in the installer. |
| Optional patched Codex runtime | Apache-2.0; see [runtime-patches/LICENSE](runtime-patches/LICENSE) and [CODEX-NOTICE](runtime-patches/CODEX-NOTICE). It is distributed separately. |

The original Codex / ChatGPT app is a prerequisite and is not relicensed by this project. This is an independent project, not affiliated with OpenAI.

原版 Codex / ChatGPT 应用是使用前提，其许可不因本项目而改变。本项目为独立工具，与 OpenAI 无隶属关系。
