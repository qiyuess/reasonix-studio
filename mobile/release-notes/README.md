# Android 发布说明

每个版本的说明在 `android/<version>.md`，文件名必须与 `package.json` 的版本号一致。
根仓库的 `release-studio.yml` 在构建前会校验这份说明与 `latest.json` 一致；没有它就不会发布。

发版流程见 [../RELEASING.md](../RELEASING.md)。

**已知限制不写在这里。** 发布说明只讲这一版改了什么；仍然做不到的事情统一记在
[docs/KNOWN_LIMITATIONS.md](../docs/KNOWN_LIMITATIONS.md)，跨版本累积。需要时在说明里加一行链接过去即可。
