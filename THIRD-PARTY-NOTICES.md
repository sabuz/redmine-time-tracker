# Third-party notices

Redmine Time Tracker is released under the [MIT License](LICENSE). It includes the following work by other people.

## Icons

**Settings cog.** The shape of the gear in the footer is the "settings" icon from [Feather](https://feathericons.com), used under the MIT License:

> MIT License
>
> Copyright (c) 2013-2017 Cole Bemis
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

**GitHub and WordPress marks.** The two icons in the About popup are the GitHub mark and the WordPress logo. They are trademarks of GitHub, Inc. and the WordPress Foundation, and are used only to link to the author's own profiles. They are not part of what the MIT License covers, and no endorsement is implied. The drawn shapes come from [Octicons](https://primer.style/foundations/icons) (`mark-github`) and [Simple Icons](https://simpleicons.org) (CC0).

## Software the app is built with

The app is built on [Tauri](https://tauri.app), [Preact](https://preactjs.com), [reqwest](https://github.com/seanmonstar/reqwest) and a few hundred other open source packages. Nearly all are under the MIT or Apache-2.0 licenses, or both. The rest are under similar permissive licenses (BSD, ISC, Zlib, Unicode, Unlicense and the like), with one exception: five Rust crates are under the Mozilla Public License 2.0, which asks that changes to their own files be shared. They are used unmodified: `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext` and `selectors`. Their source is on [crates.io](https://crates.io).

To list every Rust dependency with its license, run `cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml`. The JavaScript ones are in `package.json`, and their licenses are in `node_modules` after `npm install`.
