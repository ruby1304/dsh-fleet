# Support

Use [GitHub Issues](https://github.com/ruby1304/dsh-fleet/issues) for reproducible bugs and focused feature requests. Security reports must use the private process in [SECURITY.md](SECURITY.md).

This project currently supports:

- the latest dsh-fleet release and `main`;
- DSH versions in the compatibility range documented by that release;
- read-only inventory on supported Node.js platforms;
- single-owner convergence on macOS and Linux with the documented restart owner.

The project does not provide operational support for arbitrary shell extensions, mutable stable sources, multi-user isolation, custom forks of DSH, undisclosed production manifests, or recovery from manually edited Agent state.

For a public bug report, include only sanitized information:

- dsh-fleet and DSH versions;
- Node.js version and operating system;
- read-only or mutation path;
- a minimal synthetic manifest/config;
- exact error code and a redacted log excerpt;
- reproduction and expected behavior.

Do not post credentials, tokens, SSH configuration, usernames, hostnames, IP addresses, real absolute paths, profile files, Agent state, audit logs, or DSH session content.
