using System.Text.Json;
using GogLogin;

var result = LoginProtocol.SelfTest();
Console.WriteLine(JsonSerializer.Serialize(result));
return (bool)result["self_test_passed"]! ? 0 : 1;
