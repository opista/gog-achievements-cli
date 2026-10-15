# Included components

The executable includes the Node.js runtime (MIT and the third-party terms in its [LICENSE](https://github.com/nodejs/node/blob/v24.19.0/LICENSE)).

The Mac native helper uses the macOS AppKit, WebKit and Security system frameworks.

The updater includes [yauzl](https://github.com/thejoshwolfe/yauzl) and its dependency [pend](https://github.com/andrewrk/node-pend), both under the MIT license. Their license texts are included in `licenses/YAUZL-LICENSE.txt` and `licenses/PEND-LICENSE.txt`.

Windows builds include the .NET 10 runtime ([MIT license and third-party notices](https://github.com/dotnet/runtime)) and the Microsoft WebView2 SDK ([license](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4258.31/License)). WebView2 uses the installed Microsoft Edge WebView2 Runtime.

esbuild and postject are build tools; they are not required on the user's computer.
