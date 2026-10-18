import Foundation
import Security

func vault(_ config: [String: Any]) -> [String: Any] {
    guard let action = config["action"] as? String,
          let service = config["service"] as? String, let account = config["account"] as? String,
          !service.isEmpty, !account.isEmpty else { return ["type": "error", "code": "VAULT_UNAVAILABLE"] }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecAttrAccount as String: account,
        kSecUseAuthenticationUI as String: config["interactive"] as? Bool == true ? kSecUseAuthenticationUIAllow : kSecUseAuthenticationUIFail]
    var status: OSStatus = errSecParam
    if action == "get" {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        status = SecItemCopyMatching(search as CFDictionary, &result)
        if status == errSecItemNotFound { return ["type": "vault", "secret": NSNull()] }
        if status == errSecSuccess, let data = result as? Data, let secret = String(data: data, encoding: .utf8) {
            return ["type": "vault", "secret": secret]
        }
    } else if action == "set", let secret = config["secret"] as? String,
              let data = secret.data(using: .utf8), !data.isEmpty, data.count <= 96_000 {
        status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            status = SecItemAdd(item as CFDictionary, nil)
        }
    } else if action == "remove" {
        status = SecItemDelete(query as CFDictionary)
        if status == errSecItemNotFound { status = errSecSuccess }
    }
    return status == errSecSuccess ? ["type": "vault"] : ["type": "error", "code": "VAULT_UNAVAILABLE"]
}
