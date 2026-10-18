import Foundation

func readInput(limit: Int, errorCode: String) -> Data {
    var input = Data()
    while true {
        let part = FileHandle.standardInput.readData(ofLength: 4096)
        if part.isEmpty { return input }
        input.append(part)
        if input.count > limit { emit(["type": "error", "code": errorCode], status: 7) }
    }
}

func emit(_ event: [String: Any], status: Int32) -> Never {
    // This stdout is a private pipe read by Node. Never log URLs, cookies,
    // credentials or this response to the console or to a file.
    if let data = try? JSONSerialization.data(withJSONObject: event) {
        FileHandle.standardOutput.write(data)
    }
    exit(status)
}

@main
struct NativeLogin {
    static func main() {
        if CommandLine.arguments.dropFirst() == ["--self-test"] {
            let result = loginProtocolSelfTest()
            emit(result, status: result["self_test_passed"] as? Bool == true ? 0 : 1)
        }
        if CommandLine.arguments.dropFirst() == ["--vault-self-test"] {
            let service = "gog-achievements-cli.test." + UUID().uuidString
            let secret = String(repeating: "temporary-test", count: 1000)
            let config: [String: Any] = ["service": service, "account": "test"]
            let saved = vault(config.merging(["action": "set", "secret": secret]) { _, new in new })["type"] as? String == "vault"
            let matched = vault(config.merging(["action": "get"]) { _, new in new })["secret"] as? String == secret
            let removed = vault(config.merging(["action": "remove"]) { _, new in new })["type"] as? String == "vault"
            emit(["self_test_passed": saved && matched && removed, "checks": 3], status: saved && matched && removed ? 0 : 1)
        }

        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.isEmpty || arguments == ["--vault"] else {
            emit(["type": "error", "code": "INVALID_LOGIN_CONFIG"], status: 7)
        }
        let isVault = arguments == ["--vault"]
        let input = readInput(limit: isVault ? 120_000 : 16_000, errorCode: isVault ? "VAULT_UNAVAILABLE" : "INVALID_LOGIN_CONFIG")
        if isVault {
            guard let config = try? JSONSerialization.jsonObject(with: input) as? [String: Any] else {
                emit(["type": "error", "code": "VAULT_UNAVAILABLE"], status: 7)
            }
            let event = vault(config)
            emit(event, status: event["type"] as? String == "vault" ? 0 : 7)
        }
        guard let data = try? JSONSerialization.jsonObject(with: input) as? [String: Any], let config = parseConfig(data) else {
            emit(["type": "error", "code": "INVALID_LOGIN_CONFIG"], status: 7)
        }
        runLoginWindow(config)
    }
}
