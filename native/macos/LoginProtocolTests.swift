import Foundation

// The build embeds the same JSON cases used by the Windows test runner.
func loginProtocolSelfTest() -> [String: Any] {
    guard let data = Data(base64Encoded: loginProtocolCasesBase64),
          let cases = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let navigation = cases["navigation"] as? [[String: Any]],
          let callbacks = cases["callbacks"] as? [[String: Any]],
          let configs = cases["configs"] as? [[String: Any]],
          !navigation.isEmpty, !callbacks.isEmpty, !configs.isEmpty else {
        return ["self_test_passed": false, "checks": 0, "failed_cases": ["fixture-format"]]
    }
    var failures: [String] = []
    for item in navigation {
        let passed: Bool
        if let raw = item["url"] as? String, let url = URL(string: raw),
           let mainFrame = item["main_frame"] as? Bool, let expected = item["allowed"] as? Bool {
            passed = allowsNavigation(url, isMainFrame: mainFrame) == expected
        } else { passed = false }
        if !passed { failures.append("navigation/" + (item["name"] as? String ?? "invalid")) }
    }
    for item in callbacks {
        var passed = false
        if let raw = item["url"] as? String, let url = URL(string: raw),
           let state = item["expected_state"] as? String {
            let actual = readCallback(url, expectedState: state)
            if item["expected"] is NSNull { passed = actual == nil }
            else if let expected = item["expected"] as? [String: Any], let actual = actual {
                passed = actual.code == expected["code"] as? String &&
                    actual.state == expected["state"] as? String && actual.error == expected["error"] as? String
            }
        }
        if !passed { failures.append("callback/" + (item["name"] as? String ?? "invalid")) }
    }
    for item in configs {
        let passed: Bool
        if let input = item["input"] as? [String: Any], let expected = item["valid"] as? Bool {
            passed = (parseConfig(input) != nil) == expected
        } else { passed = false }
        if !passed { failures.append("config/" + (item["name"] as? String ?? "invalid")) }
    }
    return ["self_test_passed": failures.isEmpty,
            "checks": navigation.count + callbacks.count + configs.count, "failed_cases": failures]
}
