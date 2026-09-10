# PI-Desktop source attribution

Portions of the plugin system are adapted from [vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop),
commit `4fb58d36f4b0f05e4527d8bdf2da874e31933134`, licensed under the GNU Lesser General Public License v3.0.
The original license is preserved in [LICENSE](./LICENSE). Original copyright notices remain applicable.

The port retains the upstream plugin page markup, text, visual tokens, styles and activation behavior.
Belfry modifications split the original files into smaller modules and adapt state, desktop IPC,
plugin installation, marketplace, window hosting and runtime services to React/Tauri/Node.
Source locations are documented in `docs/plugins/pi-desktop-port.md`; adapted source files carry
an attribution header. This notice does not relicense unrelated Belfry code.

Additional Belfry changes provide a personal marketplace, author metadata and templates, immutable
local publication and static-site export. Runtime adapters bridge panel file selection and byte ranges,
theme content, Agent cancellation and session context, MCP resources and notifications, and isolated
Chromium rendering through Tauri. The compatibility checks use the unmodified upstream Browser,
Git Lens and Log Viewer sources at the pinned revision; this is not a claim of full Electron parity.
